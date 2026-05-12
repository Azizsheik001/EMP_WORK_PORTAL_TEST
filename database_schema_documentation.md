# Database Schema Documentation

This document outlines the tables and columns currently present in the Supabase PostgreSQL database for the AGS Workforce Portal. These tables are automatically created and maintained by the backend auto-migration scripts (code-first migrations).

## `admin_alerts`
Stores notifications and alerts triggered by the system for administrators (e.g., unusual clock-out patterns).

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `alert_type` | `character varying` | No | - |
| `message` | `text` | No | - |
| `details` | `jsonb` | Yes | `'{}'::jsonb` |
| `is_read` | `boolean` | Yes | `false` |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `recipient_user_id` | `uuid` | Yes | - |

## `allowance_claims`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `type` | `character varying` | No | - |
| `claim_date` | `date` | No | - |
| `amount` | `numeric` | No | - |
| `status` | `character varying` | No | `'pending'::character varying` |
| `notes` | `text` | Yes | - |
| `approved_by` | `uuid` | Yes | - |
| `receipt_url` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `allowance_policies`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `type` | `character varying` | No | - |
| `amount_per_day` | `numeric` | No | - |
| `max_per_month` | `numeric` | No | - |
| `eligible_roles` | `ARRAY` | Yes | - |
| `is_active` | `boolean` | No | `true` |
| `effective_from` | `date` | Yes | - |
| `effective_to` | `date` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `asset_assignments`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `asset_id` | `uuid` | No | - |
| `user_id` | `uuid` | No | - |
| `assigned_date` | `date` | No | `CURRENT_DATE` |
| `returned_date` | `date` | Yes | - |
| `assigned_by` | `uuid` | Yes | - |
| `notes` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `asset_categories`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `name` | `character varying` | No | - |
| `description` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `assets`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `asset_tag` | `character varying` | No | - |
| `category_id` | `uuid` | Yes | - |
| `brand` | `character varying` | No | - |
| `model` | `character varying` | No | - |
| `serial_number` | `character varying` | Yes | - |
| `purchase_date` | `date` | Yes | - |
| `purchase_cost` | `numeric` | Yes | - |
| `warranty_expiry_date` | `date` | Yes | - |
| `status` | `character varying` | No | `'available'::character varying` |
| `notes` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |
| `support_phone` | `character varying` | Yes | - |

## `auto_logout_dismissals`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `shift_date` | `date` | No | - |
| `dismissed_at` | `timestamp with time zone` | No | `now()` |

## `budget_expenses`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `budget_id` | `uuid` | No | - |
| `description` | `character varying` | No | - |
| `amount` | `numeric` | No | - |
| `expense_date` | `date` | No | - |
| `category` | `character varying` | Yes | - |
| `created_by` | `uuid` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `budgets`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `name` | `character varying` | No | - |
| `department_id` | `uuid` | Yes | - |
| `client_id` | `uuid` | Yes | - |
| `period_start` | `date` | Yes | - |
| `period_end` | `date` | Yes | - |
| `allocated_amount` | `numeric` | No | - |
| `notes` | `text` | Yes | - |
| `created_by` | `uuid` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `clients`
Stores information about the clients that employees can be scheduled for.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `name` | `character varying` | No | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |
| `team_lead_id` | `uuid` | Yes | - |
| `department_id` | `uuid` | Yes | - |

## `clock_events`
Logs all clock-in and clock-out events performed by employees, including device tracking.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `shift_date` | `date` | No | - |
| `event_type` | `character varying` | No | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `performed_by` | `uuid` | Yes | - |
| `device_type` | `character varying` | Yes | - |
| `user_agent` | `text` | Yes | - |
| `is_wfh` | `boolean` | Yes | - |

## `comp_offs`
Tracks compensatory time off (comp-offs) earned by employees for working on holidays.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `holiday_id` | `uuid` | Yes | - |
| `holiday_date` | `date` | No | - |
| `holiday_name` | `character varying` | Yes | - |
| `bonus_amount` | `numeric` | Yes | `500` |
| `comp_leave_days` | `numeric` | Yes | `1` |
| `status` | `character varying` | Yes | `'earned'::character varying` |
| `used_date` | `date` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `expiry_date` | `date` | Yes | - |

## `departments`
Stores the company departments to which employees and clients can be assigned.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `name` | `character varying` | No | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `dinner_attendees`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `dinner_event_id` | `uuid` | No | - |
| `user_id` | `uuid` | No | - |
| `coupon_given` | `boolean` | Yes | `true` |
| `coupon_amount` | `numeric` | Yes | - |
| `notes` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `dinner_events`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `event_date` | `date` | No | - |
| `title` | `character varying` | No | - |
| `location` | `character varying` | Yes | - |
| `organized_by` | `uuid` | Yes | - |
| `notes` | `text` | Yes | - |
| `total_coupons_given` | `integer` | Yes | `0` |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `updated_at` | `timestamp with time zone` | Yes | `now()` |

## `food_coupon_exclusions`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `coupon_date` | `date` | No | - |
| `excluded_by` | `uuid` | Yes | - |
| `reason` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `food_coupon_extras`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | Yes | - |
| `coupon_date` | `date` | No | - |
| `added_by` | `uuid` | Yes | - |
| `reason` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `guest_name` | `character varying` | Yes | - |

## `food_coupon_settings`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `regular_price` | `numeric` | No | `120` |
| `wednesday_price` | `numeric` | No | `160` |
| `updated_by` | `uuid` | Yes | - |
| `updated_at` | `timestamp with time zone` | Yes | `now()` |

## `food_coupons`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `coupon_date` | `date` | No | - |
| `issued_by` | `uuid` | Yes | - |
| `amount` | `numeric` | Yes | `0` |
| `notes` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `holidays`
Maintains a list of company holidays used for calculating comp-offs and leave balances.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `holiday_date` | `date` | No | - |
| `name` | `character varying` | No | - |
| `is_optional` | `boolean` | Yes | `false` |
| `calendar` | `character varying` | No | `'All'::character varying` |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `holiday_type` | `character varying` | No | `'regional'::character varying` |

## `idea_attachments`
Stores metadata and storage paths for files attached to employee idea submissions.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `idea_id` | `uuid` | No | - |
| `user_id` | `uuid` | No | - |
| `file_name` | `character varying` | No | - |
| `file_size` | `bigint` | No | - |
| `mime_type` | `character varying` | Yes | - |
| `bucket` | `character varying` | No | - |
| `storage_path` | `text` | No | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `ideas`
Stores employee suggestions/ideas submitted via the Idea Hub.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `title` | `character varying` | No | - |
| `content` | `text` | Yes | - |
| `status` | `character varying` | No | `'idea'::character varying` |
| `priority` | `character varying` | Yes | `'normal'::character varying` |
| `tags` | `ARRAY` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `updated_at` | `timestamp with time zone` | Yes | `now()` |

## `leave_balances`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `year` | `integer` | No | - |
| `total_allocated` | `numeric` | No | `0` |
| `total_used` | `numeric` | No | `0` |
| `total_remaining` | `numeric` | No | `0` |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `leave_requests`
Tracks employee leave requests, including their approval chain and status.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `employee_id` | `uuid` | No | - |
| `start_date` | `date` | No | - |
| `end_date` | `date` | No | - |
| `total_days` | `numeric` | No | - |
| `leave_type` | `character varying` | No | `'annual'::character varying` |
| `status` | `character varying` | No | `'pending_team_lead'::character varying` |
| `approval_chain` | `jsonb` | No | `'[]'::jsonb` |
| `rejected_by` | `uuid` | Yes | - |
| `rejected_at` | `timestamp with time zone` | Yes | - |
| `requested_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |
| `acknowledged_by` | `uuid` | Yes | - |
| `acknowledged_at` | `timestamp with time zone` | Yes | - |
| `start_session` | `integer` | No | `1` |
| `end_session` | `integer` | No | `2` |
| `rejection_notes` | `text` | Yes | - |
| `rejected_by_name` | `character varying` | Yes | - |
| `reason` | `text` | Yes | - |

## `notifications`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `type` | `character varying` | No | - |
| `title` | `character varying` | No | - |
| `message` | `text` | Yes | - |
| `is_read` | `boolean` | No | `false` |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `password_reset_tokens`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `token_hash` | `character varying` | No | - |
| `expires_at` | `timestamp with time zone` | No | - |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `schedule_expiry_alerts`
System alerts for when a recurring schedule pattern is about to expire.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `scope` | `character varying` | No | - |
| `entity_id` | `uuid` | No | - |
| `end_date` | `date` | No | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `schedule_uploads`
| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `client_id` | `uuid` | No | - |
| `iso_year` | `integer` | No | - |
| `week_number` | `integer` | No | - |
| `week_start_date` | `date` | Yes | - |
| `uploaded_by` | `uuid` | No | - |
| `file_url` | `text` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |

## `shift_assignments`
The core scheduling table. Stores which employee is assigned to work which shift on a specific date.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `client_id` | `uuid` | Yes | - |
| `shift_date` | `date` | No | - |
| `shift_start_time` | `time without time zone` | Yes | - |
| `shift_end_time` | `time without time zone` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |
| `is_off` | `boolean` | No | `false` |

## `shift_change_requests`
Tracks employee requests to swap or modify their assigned shift times.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `request_date` | `date` | No | - |
| `original_start_time` | `character varying` | Yes | - |
| `original_end_time` | `character varying` | Yes | - |
| `requested_start_time` | `character varying` | No | - |
| `requested_end_time` | `character varying` | No | - |
| `reason` | `text` | Yes | - |
| `status` | `character varying` | No | `'pending'::character varying` |
| `approval_chain` | `jsonb` | Yes | `'[]'::jsonb` |
| `rejected_by` | `uuid` | Yes | - |
| `rejected_at` | `timestamp with time zone` | Yes | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |
| `updated_at` | `timestamp with time zone` | Yes | `now()` |
| `request_kind` | `character varying` | No | `'future_change'::character varying` |
| `session` | `character varying` | Yes | - |
| `from_date` | `date` | Yes | - |
| `to_date` | `date` | Yes | - |
| `seen_by` | `jsonb` | Yes | `'[]'::jsonb` |

## `shift_codes`
A reference dictionary linking short codes (e.g., "US1") to specific start and end times.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `start_time` | `character varying` | No | - |
| `end_time` | `character varying` | No | - |
| `shift_code` | `character varying` | No | - |

## `user_client_assignments`
Junction table for assigning an employee to multiple clients.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `client_id` | `uuid` | No | - |
| `created_at` | `timestamp with time zone` | No | `now()` |

## `user_department_assignments`
Junction table for assigning an employee to multiple departments.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `department_id` | `uuid` | No | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `user_manager_assignments`
Junction table linking employees to their respective managers.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `manager_id` | `uuid` | No | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `user_team_lead_assignments`
Junction table linking employees to their respective team leads.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `user_id` | `uuid` | No | - |
| `team_lead_id` | `uuid` | No | - |
| `created_at` | `timestamp with time zone` | Yes | `now()` |

## `users`
The main user table for all employees, admins, managers, and team leads, storing their profile and demographic data.

| Column Name | Data Type | Nullable | Default |
| :--- | :--- | :--- | :--- |
| `id` | `uuid` | No | `gen_random_uuid()` |
| `email` | `character varying` | No | - |
| `password_hash` | `character varying` | No | - |
| `name` | `character varying` | No | - |
| `role` | `character varying` | No | - |
| `date_of_birth` | `date` | Yes | - |
| `client_id` | `uuid` | Yes | - |
| `manager_id` | `uuid` | Yes | - |
| `team_lead_id` | `uuid` | Yes | - |
| `is_active` | `boolean` | No | `true` |
| `deleted_at` | `timestamp with time zone` | Yes | - |
| `created_at` | `timestamp with time zone` | No | `now()` |
| `updated_at` | `timestamp with time zone` | No | `now()` |
| `employee_no` | `character varying` | Yes | - |
| `phone` | `character varying` | Yes | - |
| `designation` | `character varying` | Yes | - |
| `department_id` | `uuid` | Yes | - |
| `work_timezone` | `character varying` | Yes | - |
| `work_hours` | `character varying` | Yes | - |
| `must_reset_password` | `boolean` | No | `false` |
| `last_password_plain` | `character varying` | Yes | - |
| `employee_id` | `character varying` | Yes | - |
| `employment_type` | `character varying` | Yes | `'full_time'::character varying` |
| `work_location_default` | `character varying` | Yes | `'wfo'::character varying` |

