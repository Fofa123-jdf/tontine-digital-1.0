
require('dotenv').config();
const express = require('express');
const cors = require('cors');
const jwt = require('jsonwebtoken');
const bcrypt = require('bcryptjs');
const { Pool } = require('pg');
const crypto = require('crypto');
const path = require('path');

const app = express();
app.use(cors({ origin: process.env.CORS_ORIGIN ? process.env.CORS_ORIGIN.split(',') : true }));
app.use(express.json({ limit: '1mb' }));

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === 'false' ? false : { rejectUnauthorized: false },
  max: Number(process.env.DB_POOL_MAX || 10)
});

const PORT = Number(process.env.PORT || 10000);
const JWT_SECRET = process.env.JWT_SECRET || 'CHANGE_ME_IN_RENDER';
const api = express.Router();

function sign(user) {
  return jwt.sign({ sub: user.id, role: user.role, phone: user.phone }, JWT_SECRET, { expiresIn: '7d' });
}
function auth(req,res,next){
  const h=req.headers.authorization||'';
  if(!h.startsWith('Bearer ')) return res.status(401).json({error:'Authentification requise'});
  try { req.user=jwt.verify(h.slice(7),JWT_SECRET); next(); }
  catch { return res.status(401).json({error:'Jeton invalide ou expiré'}); }
}
function role(...roles){
  return (req,res,next)=>roles.includes(req.user.role) ? next() : res.status(403).json({error:'Accès administrateur refusé'});
}
function referralCode(name){
  const base=(name||'TD').replace(/[^A-Za-z0-9]/g,'').toUpperCase().slice(0,5)||'TD';
  return `${base}-${crypto.randomBytes(3).toString('hex').toUpperCase()}`;
}
async function audit(actor, action, entityType, entityId, details={}){
  try { await pool.query(
    `INSERT INTO audit_logs(actor_user_id,action,entity_type,entity_id,details) VALUES($1,$2,$3,$4,$5)`,
    [actor||null,action,entityType||null,entityId||null,details]
  ); } catch {}
}

api.get('/health', async (_req,res)=>{
  try { await pool.query('SELECT 1'); res.json({ok:true,service:'tontine-digital-api',database:'connected'}); }
  catch(e){ res.status(503).json({ok:false,database:'unavailable'}); }
});

api.post('/auth/register', async (req,res)=>{
  const {fullName,phone,email,password,referralCode:ref}=req.body||{};
  if(!fullName||!phone||!password||password.length<6) return res.status(400).json({error:'Nom, téléphone et mot de passe (6 caractères minimum) requis'});
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const existing=await c.query('SELECT id FROM users WHERE phone=$1 OR ($2::text IS NOT NULL AND email=$2)',[phone,email||null]);
    if(existing.rowCount) { await c.query('ROLLBACK'); return res.status(409).json({error:'Compte déjà existant'}); }
    let referredBy=null;
    if(ref){
      const rr=await c.query('SELECT id FROM users WHERE referral_code=$1',[ref]);
      if(rr.rowCount) referredBy=rr.rows[0].id;
    }
    let code=referralCode(fullName);
    for(let i=0;i<5;i++){
      if(!(await c.query('SELECT 1 FROM users WHERE referral_code=$1',[code])).rowCount) break;
      code=referralCode(fullName);
    }
    const hash=await bcrypt.hash(password,12);
    const u=await c.query(
      `INSERT INTO users(full_name,phone,email,password_hash,referral_code,referred_by)
       VALUES($1,$2,$3,$4,$5,$6) RETURNING id,full_name,phone,email,role,referral_code,created_at`,
      [fullName,phone,email||null,hash,code,referredBy]
    );
    await c.query('COMMIT');
    res.status(201).json({user:u.rows[0],token:sign(u.rows[0])});
  }catch(e){ await c.query('ROLLBACK'); res.status(500).json({error:'Erreur serveur'}); }
  finally{c.release();}
});

api.post('/auth/login', async (req,res)=>{
  const {identifier,password}=req.body||{};
  const q=await pool.query('SELECT * FROM users WHERE phone=$1 OR email=$1',[identifier||'']);
  if(!q.rowCount || !(await bcrypt.compare(password||'',q.rows[0].password_hash))) return res.status(401).json({error:'Identifiants incorrects'});
  const u=q.rows[0];
  res.json({user:{id:u.id,full_name:u.full_name,phone:u.phone,email:u.email,role:u.role,referral_code:u.referral_code},token:sign(u)});
});

api.get('/me',auth,async(req,res)=>{
  const q=await pool.query('SELECT id,full_name,phone,email,role,referral_code,created_at FROM users WHERE id=$1',[req.user.sub]);
  if(!q.rowCount) return res.status(404).json({error:'Utilisateur introuvable'});
  res.json(q.rows[0]);
});

api.get('/tontines',auth,async(_req,res)=>{
  const q=await pool.query('SELECT * FROM tontines WHERE active=true ORDER BY created_at DESC');
  res.json(q.rows);
});

api.post('/tontines/:id/join',auth,async(req,res)=>{
  const t=await pool.query('SELECT * FROM tontines WHERE id=$1 AND active=true',[req.params.id]);
  if(!t.rowCount) return res.status(404).json({error:'Tontine introuvable'});
  try{
    await pool.query('INSERT INTO memberships(user_id,tontine_id) VALUES($1,$2)',[req.user.sub,req.params.id]);
    await audit(req.user.sub,'JOIN_TONTINE','tontine',req.params.id,{});
    res.status(201).json({ok:true});
  }catch(e){res.status(409).json({error:'Déjà membre ou adhésion impossible'});}
});

api.post('/payments/preview',auth,async(req,res)=>{
  const {tontineId,amount}=req.body||{};
  const t=await pool.query('SELECT contribution_amount FROM tontines WHERE id=$1',[tontineId]);
  if(!t.rowCount) return res.status(404).json({error:'Tontine introuvable'});
  const base=Number(amount||t.rows[0].contribution_amount);
  const p=await pool.query(
    `SELECT EXISTS(SELECT 1 FROM payments WHERE user_id=$1 AND tontine_id=$2 AND status='CONFIRMED') AS has_paid,
            u.referred_by IS NOT NULL AS has_sponsor
     FROM users u WHERE u.id=$1`,[req.user.sub,tontineId]);
  if(!p.rowCount) return res.status(404).json({error:'Utilisateur introuvable'});
  const first=!p.rows[0].has_paid;
  const admin=first?Math.floor(base*0.01):0;
  const sponsor=first&&p.rows[0].has_sponsor?Math.floor(base*0.01):0;
  res.json({baseAmount:base,adminCommission:admin,sponsorCommission:sponsor,totalAmount:base+admin+sponsor,firstContribution:first});
});

api.post('/payments',auth,async(req,res)=>{
  const {tontineId,amount,provider}=req.body||{};
  const t=await pool.query('SELECT contribution_amount FROM tontines WHERE id=$1 AND active=true',[tontineId]);
  if(!t.rowCount) return res.status(404).json({error:'Tontine introuvable'});
  const m=await pool.query('SELECT 1 FROM memberships WHERE user_id=$1 AND tontine_id=$2',[req.user.sub,tontineId]);
  if(!m.rowCount) return res.status(403).json({error:'Vous devez rejoindre la tontine'});
  const base=Number(amount||t.rows[0].contribution_amount);
  const p=await pool.query(
    `SELECT EXISTS(SELECT 1 FROM payments WHERE user_id=$1 AND tontine_id=$2 AND status='CONFIRMED') AS has_paid,
            u.referred_by IS NOT NULL AS has_sponsor
     FROM users u WHERE u.id=$1`,[req.user.sub,tontineId]);
  const first=!p.rows[0].has_paid;
  const admin=first?Math.floor(base*0.01):0;
  const sponsor=first&&p.rows[0].has_sponsor?Math.floor(base*0.01):0;
  const total=base+admin+sponsor;
  const q=await pool.query(
    `INSERT INTO payments(user_id,tontine_id,base_amount,admin_commission,sponsor_commission,total_amount,provider)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [req.user.sub,tontineId,base,admin,sponsor,total,provider||'MANUAL_TEST']
  );
  await audit(req.user.sub,'PAYMENT_CREATED','payment',q.rows[0].id,{total});
  res.status(201).json({payment:q.rows[0],message:'Paiement créé en attente de confirmation serveur'});
});

api.get('/payments',auth,async(req,res)=>{
  const q=await pool.query('SELECT * FROM payments WHERE user_id=$1 ORDER BY created_at DESC',[req.user.sub]);
  res.json(q.rows);
});

api.get('/payments/:id/receipt',auth,async(req,res)=>{
  const q=await pool.query(
    `SELECT p.*,t.name tontine_name,u.full_name,u.phone
     FROM payments p JOIN tontines t ON t.id=p.tontine_id JOIN users u ON u.id=p.user_id
     WHERE p.id=$1 AND p.user_id=$2`,[req.params.id,req.user.sub]);
  if(!q.rowCount) return res.status(404).json({error:'Reçu introuvable'});
  res.json(q.rows[0]);
});

/* Admin */
api.get('/admin/overview',auth,role('admin','super_admin'),async(_req,res)=>{
  const [u,t,p,c,b]=await Promise.all([
    pool.query(`SELECT count(*)::int count FROM users WHERE role='member'`),
    pool.query(`SELECT count(*)::int count FROM tontines`),
    pool.query(`SELECT count(*)::int count,COALESCE(sum(total_amount),0)::int total FROM payments WHERE status='CONFIRMED'`),
    pool.query(`SELECT COALESCE(sum(admin_commission),0)::int total FROM payments WHERE status='CONFIRMED'`),
    pool.query(`SELECT count(*)::int count FROM beneficiary_payments WHERE status NOT IN ('CONFIRMED','PAID')`)
  ]);
  res.json({members:u.rows[0].count,tontines:t.rows[0].count,confirmedPayments:p.rows[0],adminCommission:c.rows[0].total,pendingBeneficiaries:b.rows[0].count});
});

api.get('/admin/users',auth,role('admin','super_admin'),async(_req,res)=>{
  const q=await pool.query(`SELECT id,full_name,phone,email,role,referral_code,referred_by,created_at FROM users ORDER BY created_at DESC`);
  res.json(q.rows);
});
api.get('/admin/tontines',auth,role('admin','super_admin'),async(_req,res)=>{
  const q=await pool.query(`SELECT t.*,count(m.id)::int members FROM tontines t LEFT JOIN memberships m ON m.tontine_id=t.id GROUP BY t.id ORDER BY t.created_at DESC`);
  res.json(q.rows);
});
api.post('/admin/tontines',auth,role('admin','super_admin'),async(req,res)=>{
  const {name,contributionAmount,frequency='monthly'}=req.body||{};
  if(!name||!Number(contributionAmount)) return res.status(400).json({error:'Nom et montant requis'});
  const q=await pool.query(`INSERT INTO tontines(name,contribution_amount,frequency) VALUES($1,$2,$3) RETURNING *`,[name,Number(contributionAmount),frequency]);
  await audit(req.user.sub,'CREATE_TONTINE','tontine',q.rows[0].id,{});
  res.status(201).json(q.rows[0]);
});
api.get('/admin/payments',auth,role('admin','super_admin'),async(_req,res)=>{
  const q=await pool.query(`SELECT p.*,u.full_name,u.phone,t.name tontine_name FROM payments p JOIN users u ON u.id=p.user_id JOIN tontines t ON t.id=p.tontine_id ORDER BY p.created_at DESC`);
  res.json(q.rows);
});
api.get('/admin/ledger',auth,role('admin','super_admin'),async(_req,res)=>{
  const q=await pool.query(`SELECT l.*,u.full_name,t.name tontine_name FROM ledger_entries l LEFT JOIN users u ON u.id=l.user_id LEFT JOIN tontines t ON t.id=l.tontine_id ORDER BY l.created_at DESC`);
  res.json(q.rows);
});
api.post('/admin/payments/:id/confirm',auth,role('admin','super_admin'),async(req,res)=>{
  const c=await pool.connect();
  try{
    await c.query('BEGIN');
    const p=await c.query('SELECT * FROM payments WHERE id=$1 FOR UPDATE',[req.params.id]);
    if(!p.rowCount){await c.query('ROLLBACK');return res.status(404).json({error:'Paiement introuvable'});}
    if(p.rows[0].status==='CONFIRMED'){await c.query('ROLLBACK');return res.json(p.rows[0]);}
    const x=p.rows[0];
    await c.query(`UPDATE payments SET status='CONFIRMED',confirmed_at=now(),provider_reference=COALESCE($2,provider_reference) WHERE id=$1`,
      [x.id,req.body.providerReference||`TD-${Date.now()}`]);
    await c.query(`INSERT INTO ledger_entries(payment_id,tontine_id,user_id,nature,amount,reference) VALUES
      ($1,$2,$3,'TONTINE_FUNDS',$4,$5),($1,$2,$3,'ADMIN_COMMISSION',$6,$5)`,
      [x.id,x.tontine_id,x.user_id,x.base_amount,req.body.providerReference||x.id,x.admin_commission]);
    if(x.sponsor_commission>0){
      const s=await c.query('SELECT referred_by FROM users WHERE id=$1',[x.user_id]);
      if(s.rows[0]?.referred_by) await c.query(
        `INSERT INTO ledger_entries(payment_id,tontine_id,user_id,nature,amount,reference) VALUES($1,$2,$3,'SPONSOR_COMMISSION',$4,$5)`,
        [x.id,x.tontine_id,s.rows[0].referred_by,x.sponsor_commission,req.body.providerReference||x.id]
      );
    }
    await c.query('COMMIT');
    await audit(req.user.sub,'CONFIRM_PAYMENT','payment',x.id,{});
    res.json({...x,status:'CONFIRMED'});
  }catch(e){await c.query('ROLLBACK');res.status(500).json({error:'Confirmation impossible'});}
  finally{c.release();}
});

api.get('/admin/beneficiary-payments',auth,role('admin','super_admin'),async(_req,res)=>{
  const q=await pool.query(`SELECT b.*,u.full_name,u.phone,t.name tontine_name FROM beneficiary_payments b JOIN users u ON u.id=b.beneficiary_user_id JOIN tontines t ON t.id=b.tontine_id ORDER BY b.due_date`);
  res.json(q.rows);
});
api.post('/admin/beneficiary-payments/:id/approve',auth,role('admin','super_admin'),async(req,res)=>{
  const q=await pool.query(`UPDATE beneficiary_payments SET status='APPROVED' WHERE id=$1 AND status IN ('SCHEDULED','PREPARED','PENDING_ADMIN_VALIDATION') RETURNING *`,[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'Ordre introuvable ou état invalide'});
  await audit(req.user.sub,'APPROVE_BENEFICIARY_PAYMENT','beneficiary_payment',q.rows[0].id,{});
  res.json(q.rows[0]);
});
api.post('/admin/beneficiary-payments/:id/reject',auth,role('admin','super_admin'),async(req,res)=>{
  const q=await pool.query(`UPDATE beneficiary_payments SET status='REJECTED' WHERE id=$1 RETURNING *`,[req.params.id]);
  if(!q.rowCount)return res.status(404).json({error:'Ordre introuvable'});
  res.json(q.rows[0]);
});
api.post('/admin/beneficiary-payments/:id/mark-paid',auth,role('admin','super_admin'),async(req,res)=>{
  const q=await pool.query(`UPDATE beneficiary_payments SET status='PAID',payment_reference=$2 WHERE id=$1 RETURNING *`,[req.params.id,req.body.reference||null]);
  if(!q.rowCount)return res.status(404).json({error:'Ordre introuvable'});
  res.json(q.rows[0]);
});
api.post('/admin/beneficiary-payments/:id/confirm',auth,role('admin','super_admin'),async(req,res)=>{
  const q=await pool.query(`UPDATE beneficiary_payments SET status='CONFIRMED',payment_reference=COALESCE($2,payment_reference) WHERE id=$1 RETURNING *`,[req.params.id,req.body.reference||null]);
  if(!q.rowCount)return res.status(404).json({error:'Ordre introuvable'});
  res.json(q.rows[0]);
});

/* Wave webhook: production must use provider signature validation. */
api.post('/webhooks/wave',async(req,res)=>{
  const secret=process.env.WAVE_WEBHOOK_SECRET;
  if(secret && req.headers['x-webhook-secret']!==secret) return res.status(401).json({error:'Webhook non autorisé'});
  res.json({received:true});
});

app.use('/api',api);
app.use(express.static(path.join(__dirname,'public')));
app.get('/admin',(_req,res)=>res.sendFile(path.join(__dirname,'public','admin','index.html')));
app.get('/member',(_req,res)=>res.sendFile(path.join(__dirname,'public','member','index.html')));
app.get('/',(_req,res)=>res.send(`<!doctype html><meta charset="utf-8"><title>Tontine Digital 1.0</title><h1>Tontine Digital 1.0</h1><p><a href="/member/">Application membre</a> — <a href="/admin/">Administration</a></p>`));

async function bootstrap(){
  await pool.query(`CREATE TABLE IF NOT EXISTS _td_bootstrap_check(id int PRIMARY KEY CHECK(id=1))`);
  if(process.env.ADMIN_BOOTSTRAP_EMAIL && process.env.ADMIN_BOOTSTRAP_PASSWORD){
    const exists=await pool.query('SELECT id FROM users WHERE email=$1',[process.env.ADMIN_BOOTSTRAP_EMAIL]);
    if(!exists.rowCount){
      const hash=await bcrypt.hash(process.env.ADMIN_BOOTSTRAP_PASSWORD,12);
      const code=referralCode('ADMIN');
      await pool.query(`INSERT INTO users(full_name,phone,email,password_hash,role,referral_code) VALUES($1,$2,$3,$4,'super_admin',$5)`,
        [process.env.ADMIN_BOOTSTRAP_NAME||'Administrateur principal',process.env.ADMIN_BOOTSTRAP_PHONE||'0000000000',process.env.ADMIN_BOOTSTRAP_EMAIL,hash,code]);
      console.log('Bootstrap admin created');
    }
  }
}
app.listen(PORT,'0.0.0.0',async()=>{try{await bootstrap();console.log(`Tontine Digital API listening on ${PORT}`)}catch(e){console.error(e.message)}});
