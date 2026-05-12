import { query } from './src/lib/db.js';

async function main() {
  try {
    await query(`
      CREATE TABLE IF NOT EXISTS shift_codes (
        id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
        start_time VARCHAR(5) NOT NULL,
        end_time VARCHAR(5) NOT NULL,
        shift_code VARCHAR(20) NOT NULL,
        UNIQUE(start_time, end_time)
      );
    `);
    
    const codes = [
      ['04:30', '13:30', 'AGS1'],
      ['08:30', '17:30', 'AGS2'],
      ['17:30', '02:30', 'AGS3'],
      ['19:30', '04:30', 'AGS4'],
      ['20:30', '04:30', 'AGS5'],
      ['16:30', '04:30', 'AGS6'],
      ['04:30', '16:30', 'AGS7'],
      ['20:30', '05:30', 'AGS8'],
      ['14:30', '00:30', 'AGS9'],
      ['16:30', '01:30', 'AG10'],
      ['10:30', '19:30', 'AG11'],
      ['09:30', '17:30', 'AG13'],
      ['04:30', '12:30', 'AG14'],
      ['04:30', '10:30', 'AG15'],
      ['09:30', '16:30', 'AG16'],
      ['08:30', '16:30', 'AG18'],
      ['15:30', '00:30', 'AG19'],
      ['11:30', '20:30', 'AG20'],
      ['04:30', '09:30', 'AG21'],
      ['04:30', '11:30', 'AG22'],
      ['20:30', '02:30', 'AG23'],
      ['17:30', '05:30', 'AG24'],
      ['17:30', '23:30', 'AG25'],
      ['09:00', '18:00', 'GEN'],
      ['13:30', '22:30', 'MID'],
      ['18:30', '03:30', 'NIGT'],
      ['14:00', '23:00', '2-11'],
      ['05:30', '14:30', 'AG27'],
      ['12:00', '21:00', 'AG28'],
      ['11:00', '20:00', 'GEN4']
    ];

    for (const [st, et, cd] of codes) {
      await query('INSERT INTO shift_codes (start_time, end_time, shift_code) VALUES ($1, $2, $3) ON CONFLICT DO NOTHING', [st, et, cd]);
    }
    console.log('Shift codes seeded successfully!');
  } catch(e) {
    console.error(e);
  } finally {
    process.exit(0);
  }
}

main();
