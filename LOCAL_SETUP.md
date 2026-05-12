# Local Setup Documentation

Follow these steps to get the Employee Scheduling Portal running on your local system.

## Prerequisites
- **Node.js** (v16+ recommended)
- **PostgreSQL** database (Local or hosted like Supabase)

---

## 1. Backend Setup (API & Database)

1. **Navigate to the backend directory**
   ```bash
   cd backend
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

3. **Configure Environment Variables**
   - Copy the sample environment file to create a `.env` file:
     ```bash
     cp .env.example .env
     ```
   - Edit `.env` and fill in your `DATABASE_URL`, `JWT_SECRET`, and any other required keys.

4. **Initialize Database**
   - Create tables by executing the SQL schema found in `backend/docs/supabase_schema.sql` on your PostgreSQL database.
   - Seed the database with initial dummy data:
     ```bash
     npm run seed
     ```
     *(This creates an admin user: **admin@amgsol.com** / **admin123**)*

---

## 2. Frontend Setup (React Application)

1. **Navigate to the project root directory** (from the backend folder, go back one level)
   ```bash
   cd ..
   ```

2. **Install dependencies**
   ```bash
   npm install
   ```

---

## 3. Running the Complete Application

You can start **both** the frontend and backend servers together continuously using a single command from the **root directory**.

```bash
npm run dev:all
```

- **Frontend (UI)** will be accessible at: `http://localhost:5173`
- **Backend API** will be accessible at: `http://localhost:3000`

> *Note: If you only want to run the frontend (without fully setting up the backend database), run `npm run dev` from the root.*
