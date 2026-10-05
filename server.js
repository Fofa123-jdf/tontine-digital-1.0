require('dotenv').config();
const express=require('express');
const cors=require('cors');
const jwt=require('jsonwebtoken');
const bcrypt=require('bcryptjs');
const {Pool}=require('pg');
const crypto=require('crypto');
const fs=require('fs');
const path=require('path');

const app=express();
const PORT=Number(process.env.PORT||10000);
const JWT_SECRET=process.env.JWT_SECRET||'CHANGE_ME';
if(process.env.NODE_ENV==='production' && JWT_SECRET==='CHANGE_ME') console.warn('WARNING: configure JWT_SECRET in Render.');
app.use(cors({origin:process.env.CORS_ORIGIN?process.env.CORS_ORIGIN.split(',').map(x=>x.trim()):true}));
app.use(express.json({limit:'1mb'}));

const pool=new Pool({
  connectionString:process.env.DATABASE_URL,
  ssl:process.env.DATABASE_SSL==='false'?false:{rejectUnauthorized:false},
  max:Number(process.env.DB_POOL_MAX||10)
});

const api=express.Router();
const money=n=>Math.round(Number(n));
const pct1=n=>Math.floor(money(n)*0.01);

function tokenFor(u){return jwt.sign({sub:u.id,role:u.role,phone:u.phone},JWT_SECRET,{expiresIn:'7d'});}
function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Authentification requise'});
  try{req.user=jwt.verify(h.slice(7),JWT_SECRET);next();}catch{return res.status(401).json({error:'Session invalide ou expirée'});}
}
const roles=(...r)=>(req,res,next)=>r.includes(req.user.role)?next():res.status(403).json({error:'Accès refusé'});
function code(name){return `${(name||'TD').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,5)||'TD'}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;}
async function audit(actor,action,type,id,details={}){try{await pool.query(
 'INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)',
 [actor||null,action,type||null,id||null,details]);}catch{}}
function validAmount(n){return Number.isInteger(money(n))&&money(n)>0;}

api.get('/health',async(_req,res)=>{
  try{await pool.query('SELECT 1');res.json({ok:true,service:'tontine-digital-api',database:'connected',version:'1.0.1'});}
  catch(e){res.status(503).json({ok:false,service:'tontine-digital-api',database:'unavailable'});}
});

api.post('/auth/register',async(req,res)=>{
  const {fullName,phone,email,password,referralCode,birthDate,documentType,documentNumber}=req.body||{};
  if(!fullName||!phone||!password||String(password).length<6) return res.status(400).json({error:'Nom, téléphone et mot de passe (6 caractères minimum) requis'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const exists=await c.query('SELECT id FROM users WHERE phone=$1 OR ($2::text IS NOT NULL AND lower(email)=lower($2))',[String(phone).trim(),email||null]);
    if(exists.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Ce compte existe déjà'});}
    let referredBy=null;
    const normalizedReferralCode=String(referralCode||'').trim().toUpperCase();
    if(normalizedReferralCode){
      const r=await c.query('SELECT id FROM users WHERE referral_code=$1',[normalizedReferralCode]);
      if(!r.rowCount){
        await c.query('ROLLBACK');
        return res.status(400).json({error:'Code de parrainage invalide'});
      }
      referredBy=r.rows[0].id;
    }
    // Chaque nouveau membre reçoit automatiquement son propre code unique.
    // Le premier membre n'a simplement aucun parrain; son code devient disponible
    // pour les inscriptions suivantes.
    let ref=code(fullName);
    for(let i=0;i<10;i++){if(!(await c.query('SELECT 1 FROM users WHERE referral_code=$1',[ref])).rowCount)break;ref=code(fullName);}
    const hash=await bcrypt.hash(password,12);
    const q=await c.query(
      `INSERT INTO users(full_name,phone,email,password_hash,referral_code,referred_by,birth_date,document_type,document_number)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)
       RETURNING id,full_name,phone,email,role,referral_code,birth_date,document_type,document_number,created_at`,
      [String(fullName).trim(),String(phone).trim(),email||null,hash,ref,referredBy,birthDate||null,documentType||null,documentNumber||null]);
    await c.query('COMMIT');
    const u=q.rows[0];
    res.status(201).json({user:u,token:tokenFor(u)});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Inscription impossible'});}
  finally{c.release();}
});

api.post('/auth/login',async(req,res)=>{
  const {identifier,password}=req.body||{};
  if(!identifier||!password)return res.status(400).json({error:'Identifiant et mot de passe requis'});
  const q=await pool.query('SELECT * FROM users WHERE phone=$1 OR lower(email)=lower($1)',[String(identifier).trim()]);
  if(!q.rowCount||!(await bcrypt.compare(password,q.rows[0].password_hash)))return res.status(401).json({error:'Identifiants incorrects'});
  const u=q.rows[0];
  res.json({user:{id:u.id,full_name:u.full_name,phone:u.phone,email:u.email,role:u.role,referral_code:u.referral_code},token:tokenFor(u)});
});
api.get('/me',auth,async(req,res)=>{
  const q=await pool.query('SELECT id,full_name,phone,email,role,referral_code,birth_date,document_type,document_number,created_at FROM users WHERE id=$1',[req.user.sub]);
  if(!q.rowCount)return res.status(404).json({error:'Utilisateur introuvable'});res.json(q.rows[0]);
});

api.get('/tontines',auth,async(_req,res)=>res.json((await pool.query('SELECT * FROM tontines WHERE active=true ORDER BY created_at DESC')).rows));
api.post('/tontines/:id/join',auth,async(req,res)=>{
  const t=await pool.query('SELECT id FROM tontines WHERE id=$1 AND active=true',[req.params.id]);
  if(!t.rowCount)return res.status(404).json({error:'Tontine introuvable'});
  try{await pool.query('INSERT INTO memberships(user_id,tontine_id) VALUES($1,$2)',[req.user.sub,req.params.id]);await audit(req.user.sub,'JOIN_TONTINE','tontine',req.params.id);res.status(201).json({ok:true});}
  catch{res.status(409).json({error:'Vous êtes déjà membre de cette tontine'});}
});
api.get('/memberships',auth,async(req,res)=>res.json((await pool.query(
 `SELECT m.*,t.name,t.contribution_amount,t.frequency FROM memberships m JOIN tontines t ON t.id=m.tontine_id WHERE m.user_id=$1 ORDER BY m.joined_at DESC`,[req.user.sub])).rows));

async function paymentQuote(userId,tontineId,amount){
  const t=await pool.query('SELECT contribution_amount FROM tontines WHERE id=$1 AND active=true',[tontineId]);
  if(!t.rowCount)throw Object.assign(new Error('Tontine introuvable'),{status:404});
  const base=money(amount||t.rows[0].contribution_amount);
  if(!validAmount(base))throw Object.assign(new Error('Montant invalide'),{status:400});
  const m=await pool.query('SELECT 1 FROM memberships WHERE user_id=$1 AND tontine_id=$2',[userId,tontineId]);
  if(!m.rowCount)throw Object.assign(new Error('Vous devez rejoindre la tontine'),{status:403});
  const q=await pool.query(
    `SELECT EXISTS(SELECT 1 FROM payments WHERE user_id=$1 AND tontine_id=$2 AND status='CONFIRMED') has_paid,
            EXISTS(SELECT 1 FROM users WHERE id=$1 AND referred_by IS NOT NULL) has_sponsor`,
    [userId,tontineId]);
  const first=!q.rows[0].has_paid;
  const admin=first?pct1(base):0;
  const sponsor=first&&q.rows[0].has_sponsor?pct1(base):0; // 1% du premier versement uniquement
  return {baseAmount:base,adminCommission:admin,sponsorCommission:sponsor,totalAmount:base+admin+sponsor,firstContribution:first};
}
api.post('/payments/preview',auth,async(req,res)=>{
  try{res.json(await paymentQuote(req.user.sub,req.body?.tontineId,req.body?.amount));}
  catch(e){res.status(e.status||500).json({error:e.message});}
});
api.post('/payments',auth,async(req,res)=>{
  const {tontineId,amount,provider='MANUAL_TEST'}=req.body||{};
  const idem=String(req.get('Idempotency-Key')||req.body?.idempotencyKey||'').trim()||null;
  try{
    if(idem){
      const old=await pool.query('SELECT * FROM payments WHERE user_id=$1 AND tontine_id=$2 AND idempotency_key=$3',[req.user.sub,tontineId,idem]);
      if(old.rowCount)return res.status(200).json({payment:old.rows[0],replayed:true});
    }
    const q=await paymentQuote(req.user.sub,tontineId,amount);
    const c=await pool.connect();
    try{
      await c.query('BEGIN');
      const pending=await c.query('SELECT * FROM payments WHERE user_id=$1 AND tontine_id=$2 AND status=$3 FOR UPDATE',[req.user.sub,tontineId,'PENDING']);
      if(pending.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Un paiement est déjà en attente pour cette tontine',payment:pending.rows[0]});}
      const ins=await c.query(
       `INSERT INTO payments(user_id,tontine_id,base_amount,admin_commission,sponsor_commission,total_amount,provider,idempotency_key)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8) RETURNING *`,
       [req.user.sub,tontineId,q.baseAmount,q.adminCommission,q.sponsorCommission,q.totalAmount,String(provider),idem]);
      await c.query('COMMIT');
      await audit(req.user.sub,'PAYMENT_CREATED','payment',ins.rows[0].id,{total:q.totalAmount});
      return res.status(201).json({payment:ins.rows[0],message:'Paiement créé en attente de confirmation'});
    }catch(e){await c.query('ROLLBACK');if(e.code==='23505')return res.status(409).json({error:'Paiement déjà enregistré'});throw e;}
    finally{c.release();}
  }catch(e){res.status(e.status||500).json({error:e.message||'Paiement impossible'});}
});
api.get('/referrals',auth,async(req,res)=>{
  const q=await pool.query(`
    SELECT u.id,u.full_name,u.phone,u.created_at,
           COALESCE(SUM(CASE WHEN l.nature='SPONSOR_COMMISSION' THEN l.amount ELSE 0 END),0)::int AS commission_earned
    FROM users u
    LEFT JOIN ledger_entries l ON l.user_id=u.id
    WHERE u.referred_by=$1
    GROUP BY u.id
    ORDER BY u.created_at DESC
  `,[req.user.sub]);
  const total=q.rows.reduce((sum,row)=>sum+Number(row.commission_earned||0),0);
  res.json({referralCode:(await pool.query('SELECT referral_code FROM users WHERE id=$1',[req.user.sub])).rows[0]?.referral_code||null,referrals:q.rows,totalCommission:total,rate:1});
});
api.get('/payments',auth,async(req,res)=>res.json((await pool.query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC',[req.user.sub])).rows));
api.get('/payments/:id/receipt',auth,async(req,res)=>{
  const q=await pool.query(`SELECT p.*,t.name tontine_name,u.full_name,u.phone FROM payments p JOIN tontines t ON t.id=p.tontine_id JOIN users u ON u.id=p.user_id WHERE p.id=$1 AND p.user_id=$2`,[req.params.id,req.user.sub]);
  if(!q.rowCount)return res.status(404).json({error:'Reçu introuvable'});res.json(q.rows[0]);
});
api.get('/notifications',auth,async(req,res)=>res.json((await pool.query('SELECT * FROM notifications WHERE user_id=$1 ORDER BY created_at DESC LIMIT 100',[req.user.sub])).rows));

/* ADMIN */
api.get('/admin/overview',auth,roles('admin','super_admin'),async(_req,res)=>{
  const [u,t,p,c,b]=await Promise.all([
    pool.query(`SELECT count(*)::int count FROM users WHERE role='member'`),
    pool.query(`SELECT count(*)::int count FROM tontines`),
    pool.query(`SELECT count(*)::int count,COALESCE(sum(total_amount),0)::int total FROM payments WHERE status='CONFIRMED'`),
    pool.query(`SELECT COALESCE(sum(admin_commission),0)::int total FROM payments WHERE status='CONFIRMED'`),
    pool.query(`SELECT count(*)::int count FROM beneficiary_payments WHERE status NOT IN ('CONFIRMED','PAID','REJECTED')`)
  ]);
  res.json({members:u.rows[0].count,tontines:t.rows[0].count,confirmedPayments:p.rows[0],adminCommission:c.rows[0].total,pendingBeneficiaries:b.rows[0].count});
});
api.get('/admin/users',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query(`
  SELECT u.id,u.full_name,u.phone,u.email,u.role,u.referral_code,u.referred_by,
         p.full_name AS sponsor_name,u.birth_date,u.document_type,u.document_number,u.created_at
  FROM users u
  LEFT JOIN users p ON p.id=u.referred_by
  ORDER BY u.created_at DESC
`)).rows));
api.get('/admin/tontines',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query(`SELECT t.*,count(m.id)::int members FROM tontines t LEFT JOIN memberships m ON m.tontine_id=t.id GROUP BY t.id ORDER BY t.created_at DESC`)).rows));
api.post('/admin/tontines',auth,roles('admin','super_admin'),async(req,res)=>{
  const {name,contributionAmount,frequency='monthly'}=req.body||{};
  if(!name||!validAmount(contributionAmount))return res.status(400).json({error:'Nom et montant valides requis'});
  const q=await pool.query('INSERT INTO tontines(name,contribution_amount,frequency) VALUES($1,$2,$3) RETURNING *',[String(name).trim(),money(contributionAmount),frequency]);
  await audit(req.user.sub,'CREATE_TONTINE','tontine',q.rows[0].id);res.status(201).json(q.rows[0]);
});
api.get('/admin/payments',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query(`SELECT p.*,u.full_name,u.phone,t.name tontine_name FROM payments p JOIN users u ON u.id=p.user_id JOIN tontines t ON t.id=p.tontine_id ORDER BY p.created_at DESC`)).rows));
api.get('/admin/ledger',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query(`SELECT l.*,u.full_name,t.name tontine_name FROM ledger_entries l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN tontines t ON t.id=l.tontine_id ORDER BY l.created_at DESC`)).rows));
api.get('/admin/collection-accounts',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query('SELECT * FROM collection_accounts ORDER BY created_at DESC')).rows));
api.post('/admin/collection-accounts',auth,roles('admin','super_admin'),async(req,res)=>{
  const {provider,label,accountIdentifier}=req.body||{};
  if(!provider||!label||!accountIdentifier)return res.status(400).json({error:'Prestataire, libellé et compte requis'});
  const q=await pool.query('INSERT INTO collection_accounts(provider,label,account_identifier) VALUES($1,$2,$3) RETURNING *',[provider,label,accountIdentifier]);
  await audit(req.user.sub,'CREATE_COLLECTION_ACCOUNT','collection_account',q.rows[0].id);res.status(201).json(q.rows[0]);
});

api.post('/admin/payments/:id/confirm',auth,roles('admin','super_admin'),async(req,res)=>{
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const p=await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!p.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Paiement introuvable'});}
    const x=p.rows[0];
    if(x.status==='CONFIRMED'){await c.query('ROLLBACK');return res.json(x);}
    if(x.status!=='PENDING'){await c.query('ROLLBACK');return res.status(409).json({error:'Ce paiement ne peut pas être confirmé'});}
    const ref=String(req.body?.providerReference||`TD-${Date.now()}-${crypto.randomBytes(2).toString('hex')}`);
    const dup=await c.query('SELECT id FROM payments WHERE provider_reference=$1 AND id<>$2',[ref,x.id]);
    if(dup.rowCount){await c.query('ROLLBACK');return res.status(409).json({error:'Référence prestataire déjà utilisée'});}
    await c.query(`UPDATE payments SET status='CONFIRMED',confirmed_at=now(),provider_reference=$2 WHERE id=$1`,[x.id,ref]);
    await c.query(`INSERT INTO ledger_entries(payment_id,tontine_id,user_id,nature,amount,reference) VALUES($1,$2,$3,'TONTINE_FUNDS',$4,$5),($1,$2,$3,'ADMIN_COMMISSION',$6,$5)`,
      [x.id,x.tontine_id,x.user_id,x.base_amount,ref,x.admin_commission]);
    if(x.sponsor_commission>0){
      const s=await c.query('SELECT referred_by FROM users WHERE id=$1',[x.user_id]);
      if(s.rows[0]?.referred_by)await c.query(`INSERT INTO ledger_entries(payment_id,tontine_id,user_id,nature,amount,reference) VALUES($1,$2,$3,'SPONSOR_COMMISSION',$4,$5)`,
        [x.id,x.tontine_id,s.rows[0].referred_by,x.sponsor_commission,ref]);
    }
    await c.query('COMMIT');await audit(req.user.sub,'CONFIRM_PAYMENT','payment',x.id,{providerReference:ref});
    res.json({ok:true,status:'CONFIRMED',providerReference:ref});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Confirmation impossible'});}finally{c.release();}
});

api.get('/admin/beneficiary-payments',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query(`SELECT b.*,u.full_name,u.phone,t.name tontine_name FROM beneficiary_payments b JOIN users u ON u.id=b.beneficiary_user_id JOIN tontines t ON t.id=b.tontine_id ORDER BY b.due_date,b.created_at`)).rows));
api.post('/admin/beneficiary-payments',auth,roles('admin','super_admin'),async(req,res)=>{
  const {tontineId,beneficiaryUserId,amount,dueDate,provider,sourceAccount}=req.body||{};
  if(!tontineId||!beneficiaryUserId||!validAmount(amount)||!dueDate)return res.status(400).json({error:'Tontine, bénéficiaire, montant et date requis'});
  const q=await pool.query(`INSERT INTO beneficiary_payments(tontine_id,beneficiary_user_id,amount,due_date,provider,source_account,status)
    VALUES($1,$2,$3,$4,$5,$6,'PREPARED') RETURNING *`,[tontineId,beneficiaryUserId,money(amount),dueDate,provider||null,sourceAccount||null]);
  await audit(req.user.sub,'CREATE_BENEFICIARY_PAYMENT','beneficiary_payment',q.rows[0].id);res.status(201).json(q.rows[0]);
});
async function beneficiaryUpdate(req,res,nextStatus,allowed){
  const q=await pool.query(`UPDATE beneficiary_payments SET status=$2 WHERE id=$1 AND status=ANY($3::text[]) RETURNING *`,[req.params.id,nextStatus,allowed]);
  if(!q.rowCount)return res.status(409).json({error:'Ordre introuvable ou état invalide'});res.json(q.rows[0]);
}
api.post('/admin/beneficiary-payments/:id/approve',auth,roles('admin','super_admin'),(req,res)=>beneficiaryUpdate(req,res,'APPROVED',['SCHEDULED','PREPARED','PENDING_ADMIN_VALIDATION']));
api.post('/admin/beneficiary-payments/:id/reject',auth,roles('admin','super_admin'),(req,res)=>beneficiaryUpdate(req,res,'REJECTED',['SCHEDULED','PREPARED','PENDING_ADMIN_VALIDATION','APPROVED']));
api.post('/admin/beneficiary-payments/:id/mark-paid',auth,roles('admin','super_admin'),async(req,res)=>{
  const ref=String(req.body?.reference||'').trim();if(!ref)return res.status(400).json({error:'Référence de paiement requise'});
  const q=await pool.query(`UPDATE beneficiary_payments SET status='PAID',payment_reference=$2 WHERE id=$1 AND status IN ('APPROVED','PAYMENT_IN_PROGRESS') RETURNING *`,[req.params.id,ref]);
  if(!q.rowCount)return res.status(409).json({error:'Ordre introuvable ou état invalide'});res.json(q.rows[0]);
});
api.post('/admin/beneficiary-payments/:id/confirm',auth,roles('admin','super_admin'),async(req,res)=>{
  const q=await pool.query(`UPDATE beneficiary_payments SET status='CONFIRMED',payment_reference=COALESCE($2,payment_reference) WHERE id=$1 AND status='PAID' RETURNING *`,[req.params.id,req.body?.reference||null]);
  if(!q.rowCount)return res.status(409).json({error:'Le paiement doit d’abord être marqué PAID'});res.json(q.rows[0]);
});
api.get('/admin/audit',auth,roles('admin','super_admin'),async(_req,res)=>res.json((await pool.query('SELECT * FROM audit_logs ORDER BY created_at DESC LIMIT 500')).rows));

/* Test/manual webhook. A real provider integration must validate its official signature before changing financial state. */
api.post('/webhooks/wave',async(req,res)=>{
  const secret=process.env.WAVE_WEBHOOK_SECRET;
  if(secret && req.get('x-webhook-secret')!==secret)return res.status(401).json({error:'Webhook non autorisé'});
  res.json({received:true,mode:'acknowledged'});
});

app.use('/api',api);
app.use(express.static(path.join(__dirname,'public'),{extensions:['html']}));
app.get('/admin',(_req,res)=>res.sendFile(path.join(__dirname,'public/admin/index.html')));
app.get('/member',(_req,res)=>res.sendFile(path.join(__dirname,'public/member/index.html')));
app.get('/',(_req,res)=>res.sendFile(path.join(__dirname,'public/index.html')));

async function bootstrap(){
  const schema=fs.readFileSync(path.join(__dirname,'schema.sql'),'utf8');
  await pool.query(schema);
  if(process.env.ADMIN_BOOTSTRAP_EMAIL&&process.env.ADMIN_BOOTSTRAP_PASSWORD){
    const exists=await pool.query('SELECT id FROM users WHERE lower(email)=lower($1)',[process.env.ADMIN_BOOTSTRAP_EMAIL]);
    if(!exists.rowCount){
      const hash=await bcrypt.hash(process.env.ADMIN_BOOTSTRAP_PASSWORD,12);
      const q=await pool.query(`INSERT INTO users(full_name,phone,email,password_hash,role,referral_code)
        VALUES($1,$2,$3,$4,'super_admin',$5) RETURNING id`,[
          process.env.ADMIN_BOOTSTRAP_NAME||'Administrateur principal',
          process.env.ADMIN_BOOTSTRAP_PHONE||`ADMIN-${Date.now()}`,
          process.env.ADMIN_BOOTSTRAP_EMAIL,hash,code('ADMIN')]);
      console.log('Bootstrap admin created:',q.rows[0].id);
    }
  }
}
app.listen(PORT,'0.0.0.0',async()=>{try{await bootstrap();console.log(`Tontine Digital API listening on ${PORT}`)}catch(e){console.error('BOOTSTRAP ERROR:',e.message)}});

process.on('SIGTERM',async()=>{await pool.end();process.exit(0);});
