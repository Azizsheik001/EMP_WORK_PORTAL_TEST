import fs from 'fs';
import path from 'path';
import csv from 'csv-parser';
import bcrypt from 'bcryptjs';
import 'dotenv/config';
import { query } from './src/lib/db.js';

const ACTUALLY_UPDATE_DB = true;
const CSV_FILE_PATH = 'C:\\Users\\LibsysAdmin\\OneDrive - Libsys IT Services Private Limited\\Desktop\\Employee Scheduling Portal\\employees data.csv';

async function importUsers() {
  console.log(`Starting User Import Script...`);
  console.log(`DRY RUN MODE: ${!ACTUALLY_UPDATE_DB ? 'ON (No database changes will be made)' : 'OFF (Database WILL be updated)'}`);

  if (!fs.existsSync(CSV_FILE_PATH)) {
    console.error(`Error: Could not find CSV file at ${CSV_FILE_PATH}`);
    console.log('Please save your Excel file as a CSV and name it "employees.csv" in the backend folder.');
    return;
  }

  const results = [];

  fs.createReadStream(CSV_FILE_PATH)
    .pipe(csv())
    .on('data', (data) => results.push(data))
    .on('end', async () => {
      console.log(`Successfully read ${results.length} rows from CSV.`);

      let newUsersCount = 0;
      let updatedUsersCount = 0;
      let skippedCount = 0;

      for (const row of results) {
        const employeeNo = row['Employee Number'] || row['Employee No'] || row['Employee No.'] || '';
        const name = row['Employee Name'] || '';
        const email = row['Email'] || '';
        const dobRaw = row['Date Of Birth'] || '';
        const phone = row['Phone'] || row['Phone No'] || '';
        const gender = row['Gender'] || ''; // (if needed later)

        // Format the Date of Birth to YYYY-MM-DD if it's not empty
        let dateOfBirth = null;
        if (dobRaw) {
          // Assuming format from excel might be DD-MMM-YYYY or similar
          const parsedDate = new Date(dobRaw);
          if (!isNaN(parsedDate.getTime())) {
            // Extract local parts to prevent timezone shifts (e.g. 31 Dec 1990 -> 1990-12-30 UTC)
            const y = parsedDate.getFullYear();
            const m = String(parsedDate.getMonth() + 1).padStart(2, '0');
            const d = String(parsedDate.getDate()).padStart(2, '0');
            dateOfBirth = `${y}-${m}-${d}`;
          }
        }

        if (!employeeNo && !email) {
          console.log(`Skipping row with no Employee No and no Email: ${name}`);
          skippedCount++;
          continue;
        }

        // Try to find if user exists by Employee No (or Email as fallback)
        let existingUser = null;
        try {
          const res = await query('SELECT * FROM users WHERE employee_no = $1 OR email = $2 LIMIT 1', [employeeNo, email.toLowerCase()]);
          if (res.rows.length > 0) {
            existingUser = res.rows[0];
          }
        } catch (dbErr) {
          console.error("Database query failed:", dbErr);
          return;
        }

        if (existingUser) {
          // UPDATE SCENARIO
          console.log(`[UPDATE] Found existing user: ${existingUser.name} (${existingUser.email})`);
          console.log(`   -> Will update DOB: ${dateOfBirth}, Phone: ${phone}, Email: ${email}, EmpNo: ${employeeNo}`);

          if (ACTUALLY_UPDATE_DB) {
            await query(
              `UPDATE users 
               SET email = $1, date_of_birth = $2, phone = $3, employee_no = $4, updated_at = now() 
               WHERE id = $5`,
              [email.toLowerCase(), dateOfBirth, phone, employeeNo || existingUser.employee_no, existingUser.id]
            );
          }
          updatedUsersCount++;
        } else {
          // INSERT SCENARIO
          console.log(`[CREATE] New user detected: ${name} (${email})`);

          if (ACTUALLY_UPDATE_DB) {
            // Give new users a default password
            const defaultPasswordHash = await bcrypt.hash('Welcome@123', 10);

            await query(
              `INSERT INTO users (email, password_hash, name, role, employee_no, date_of_birth, phone, created_at)
               VALUES ($1, $2, $3, 'employee', $4, $5, $6, now())`,
              [email.toLowerCase(), defaultPasswordHash, name, employeeNo, dateOfBirth, phone]
            );
          }
          newUsersCount++;
        }
      }

      console.log('--------------------------------------------------');
      console.log('Summary:');
      console.log(`New Users to Create: ${newUsersCount}`);
      console.log(`Existing Users to Update: ${updatedUsersCount}`);
      console.log(`Rows Skipped: ${skippedCount}`);

      if (!ACTUALLY_UPDATE_DB) {
        console.log('\nTHIS WAS A DRY RUN. No data was actually written to the database.');
        console.log('To execute these changes, change ACTUALLY_UPDATE_DB to true in import-users.js.');
      } else {
        console.log('\nDATABASE HAS BEEN UPDATED SUCCESSFULLY.');
      }

      process.exit(0);
    });
}

importUsers();
