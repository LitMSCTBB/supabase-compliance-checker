# 🔒 Supabase Compliance Checker

A full-stack tool to check and fix compliance settings on any Supabase project — including **RLS**, **PITR**, and **MFA** — with automated fixes, toast notifications, and an AI assistant.

---

## 🧱 Tech Stack

- **Frontend:** Next.js (in `/frontend`)
- **Backend:** Node.js (Express) in `/backend`
- **DB:** Supabase (Postgres)
- **AI Assistant:** OpenAI API
- **Notifications:** Sonner (toast system)
- **Hosting:** Vercel (frontend) + Railway (backend)

---

## 🚀 Features

- ✅ **RLS Check & Fix**: Detects missing Row-Level Security and enables it via SQL
- ✅ **PITR Check & Fix**: Queries project config via Supabase Management API and enables if permitted
- ✅ **MFA Check**: Uses Supabase Admin API to identify users with or without MFA enabled
- 🤖 **AI Assistant**: Chat to generate RLS policies, explain compliance gaps, or surface docs
- ✅ **Global Toast Notifications**: Instant success/fail feedback for all user actions
- 🪵 **Backend Logging**: Errors and actions are logged for auditing and debugging

---

## 🗂 Project Structure

/frontend → Next.js app (UI, chat, toasts)
/backend → Node.js server (API, DB, fixes)