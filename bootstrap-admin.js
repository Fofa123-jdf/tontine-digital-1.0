require('dotenv').config();
const crypto=require('crypto'); const {Pool}=require('pg');
const pool=new Pool({connectionString:process.env.DATABASE_URL,ssl:process.env.DATABASE_SSL==='true'?{rejectUnauthorized:false}:false});
const email=process.env.ADMIN_BOOTSTRAP_EMAIL,password=process.env.ADMIN_BOOTSTRAP_PASSWORD;
if(!email||!password){console.error('ADMIN_BOOTSTRAP_EMAIL et ADMIN_BOOTSTRAP_PASSWORD sont requis');process.exit(1)}
const hash=p=>crypto.scryptSync(p,process.env.PASSWORD_SALT||'tontine-digital-salt',64).toString('hex');
(async()=>{try{const r=await pool.query(`INSERT INTO users(full_name,birth_date,phone,email,password_hash,referral_code,role) VALUES($1,$2,$3,$4,$5,$6,'super_admin') ON CONFLICT(email) DO UPDATE SET password_hash=EXCLUDED.password_hash,role='super_admin' RETURNING id,email,role`,['Administrateur','1970-01-01','ADMIN-NON-MOBILE',email,hash(password),'ADMIN-'+crypto.randomBytes(4).toString('hex').toUpperCase()]);console.log(r.rows[0])}finally{await pool.end()}})();
