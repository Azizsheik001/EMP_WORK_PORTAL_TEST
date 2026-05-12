import pg from 'pg';
import dotenv from 'dotenv';
import fs from 'fs';
dotenv.config();

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });

const tableDescriptions = {
  admin_alerts: 'Stores notifications and alerts triggered by the system for administrators (e.g., unusual clock-out patterns).',
  clients: 'Stores information about the clients that employees can be scheduled for.',
  clock_events: 'Logs all clock-in and clock-out events performed by employees, including device tracking.',
  comp_offs: 'Tracks compensatory time off (comp-offs) earned by employees for working on holidays.',
  departments: 'Stores the company departments to which employees and clients can be assigned.',
  holidays: 'Maintains a list of company holidays used for calculating comp-offs and leave balances.',
  idea_attachments: 'Stores metadata and storage paths for files attached to employee idea submissions.',
  ideas: 'Stores employee suggestions/ideas submitted via the Idea Hub.',
  leave_requests: 'Tracks employee leave requests, including their approval chain and status.',
  schedule_expiry_alerts: 'System alerts for when a recurring schedule pattern is about to expire.',
  shift_assignments: 'The core scheduling table. Stores which employee is assigned to work which shift on a specific date.',
  shift_change_requests: 'Tracks employee requests to swap or modify their assigned shift times.',
  shift_codes: 'A reference dictionary linking short codes (e.g., "US1") to specific start and end times.',
  user_client_assignments: 'Junction table for assigning an employee to multiple clients.',
  user_department_assignments: 'Junction table for assigning an employee to multiple departments.',
  user_manager_assignments: 'Junction table linking employees to their respective managers.',
  user_team_lead_assignments: 'Junction table linking employees to their respective team leads.',
  users: 'The main user table for all employees, admins, managers, and team leads, storing their profile and demographic data.'
};

async function main() {
  try {
    const query = `
      SELECT table_name, column_name, data_type, is_nullable, column_default
      FROM information_schema.columns
      WHERE table_schema = 'public'
      ORDER BY table_name, ordinal_position;
    `;
    const res = await pool.query(query);
    
    const tables = {};
    for (const row of res.rows) {
      if (!tables[row.table_name]) tables[row.table_name] = [];
      tables[row.table_name].push(row);
    }

    let md = '# Database Schema Documentation\n\n';
    md += 'This document outlines the tables and columns currently present in the Supabase PostgreSQL database for the AGS Workforce Portal. These tables are automatically created and maintained by the backend auto-migration scripts (code-first migrations).\n\n';

    for (const tableName of Object.keys(tables).sort()) {
      md += `## \`${tableName}\`\n`;
      if (tableDescriptions[tableName]) {
        md += `${tableDescriptions[tableName]}\n\n`;
      }
      md += '| Column Name | Data Type | Nullable | Default |\n';
      md += '| :--- | :--- | :--- | :--- |\n';
      
      for (const col of tables[tableName]) {
        const isNullable = col.is_nullable === 'YES' ? 'Yes' : 'No';
        const defaultVal = col.column_default ? `\`${col.column_default}\`` : '-';
        md += `| \`${col.column_name}\` | \`${col.data_type}\` | ${isNullable} | ${defaultVal} |\n`;
      }
      md += '\n';
    }

    fs.writeFileSync('../database_schema_documentation.md', md);
    console.log('Markdown generated successfully.');
  } catch (e) {
    console.error(e);
  } finally {
    await pool.end();
  }
}

main();
