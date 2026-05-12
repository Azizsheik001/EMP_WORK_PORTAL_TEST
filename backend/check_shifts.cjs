const pg = require('pg');
const pool = new pg.Pool({ connectionString: 'postgres://postgres:postgres@localhost:5432/ags_workforce' });
pool.query("SELECT shift_date, shift_start_time, shift_end_time, is_off FROM shift_assignments sa JOIN users u ON u.id = sa.user_id WHERE u.name ILIKE '%Abdul Aziz%' AND shift_date >= '2026-05-10' AND shift_date <= '2026-05-31' ORDER BY shift_date").then(res => { 
    console.log(res.rows); 
    pool.end(); 
}).catch(console.error);
