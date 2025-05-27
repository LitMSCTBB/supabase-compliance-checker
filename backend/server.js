// delve-backend/server.js
require("dotenv").config();
const express = require("express");
const cors = require("cors");
const { createClient } = require("@supabase/supabase-js");
const fs = require("fs");
const path = require("path");
const { Client } = require("pg");
const { parse } = require("pg-connection-string");
const postgres = require("postgres");
const fetch = (...args) =>
  import("node-fetch").then((mod) => mod.default(...args));
const { OpenAI } = require("openai");
const { Pool } = require("pg");
const puppeteer = require("puppeteer");

const app = express();
const port = process.env.NODE_PORT || 3001;

// ✅ CORS config
const allowedOrigins = [
  "http://localhost:3000",
  "https://supabase-compliance-checker-ten.vercel.app",
];

app.use(
  cors({
    origin: function (origin, callback) {
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
      } else {
        callback(new Error("Not allowed by CORS"));
      }
    },
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["Content-Type", "Authorization"],
  })
);

// ✅ Preflight support
app.options("/api/*", cors()); // Accept all OPTIONS routes

// ✅ JSON parser
app.use(express.json());

const evidenceLogPath = path.join(__dirname, "evidence.log");

const MANAGEMENT_ACCESS_TOKEN = process.env.SUPABASE_PAT; // Store securely!

function logEvidence(level, message, data = {}) {
  const timestamp = new Date().toISOString();
  const logEntry = `${timestamp} [${level.toUpperCase()}] - ${message} | Data: ${JSON.stringify(
    data
  )}\n`;
  console.log(logEntry.trim());
  try {
    fs.appendFileSync(evidenceLogPath, logEntry);
  } catch (err) {
    console.error("Failed to write to evidence.log:", err);
  }
}

function getSupabaseClient(projectUrl, serviceKey) {
  if (!projectUrl || !serviceKey) {
    throw new Error("Supabase project URL and service key are required.");
  }
  if (!projectUrl.startsWith("http://") && !projectUrl.startsWith("https://")) {
    throw new Error(
      "Invalid Supabase project URL format. It should start with http:// or https://"
    );
  }
  return createClient(projectUrl, serviceKey);
}

async function listTablesFromOpenApi(projectUrl, apiKey) {
  // Extract the project ref from the URL
  const projectRef = projectUrl.replace(/^https?:\/\//, "").split(".")[0];
  const openApiUrl = `https://${projectRef}.supabase.co/rest/v1/`;

  const res = await fetch(openApiUrl, {
    headers: {
      apikey: apiKey,
      Authorization: `Bearer ${apiKey}`,
      Accept: "application/openapi+json, application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch OpenAPI schema: ${res.status} ${res.statusText}`
    );
  }

  const openApi = await res.json();
  const endpoints = Object.keys(openApi.paths);

  // Filter for table endpoints
  const tableNames = endpoints
    .filter((path) => !path.startsWith("/rpc/") && path.startsWith("/"))
    .map((path) => path.replace(/^\//, "").split("/")[0])
    .filter((v, i, arr) => arr.indexOf(v) === i)
    .filter((tableName) => tableName != "");

  return tableNames;
}

async function listPoliciesForTable(projectUrl, apiKey, tableName) {
  // Extract project ref from URL
  const projectRef = projectUrl.replace(/^https?:\/\//, "").split(".")[0];
  // const managementUrl = `https://api.supabase.com/v1/projects/${projectRef}/policies?schema=public&table=${tableName}`;
  const managementUrl = `https://${projectRef}.supabase.co/rest/v1/policies?schema=public&table=${tableName}`;

  const res = await fetch(managementUrl, {
    headers: {
      Authorization: `Bearer ${apiKey}`,
      apikey: apiKey,
      Accept: "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(
      `Failed to fetch policies for table "${tableName}": ${res.status} ${res.statusText}`
    );
  }

  const data = await res.json();

  console.log("data", data);

  // Normalize and return policies
  const policies = (data.policies || []).map((p) => ({
    name: p.name,
    command: p.command,
    definition: p.definition,
    roles: p.roles,
    using: p.using,
    check: p.check,
    enabled: p.enabled,
  }));

  return policies;
}

// SUPABASE COMPLIANCE CHECKER BACKEND
//
// Best Practice: Use the Supabase JS client for all compliance checks (MFA, table queries, etc.)
// unless the user provides a direct Postgres connection string (for advanced admin/internal use).
// The Postgres connection string must be the direct/ORM string (no db. prefix).
//
// Security: Never log or expose credentials. Only allow trusted admins to use the direct connection string.
//
// - Use Supabase client for: MFA, table queries, custom RPCs (recommended for most users)
// - Use pg package for: advanced checks if and only if dbConnectionString is provided (admin only)
//
// If you want to list all tables without a direct connection, create a custom RPC in Supabase and call it via supabase.rpc('list_tables').

// --- API Endpoints ---

async function runMFACheck(supabase, displayUrl) {
  let mfaResults = {
    checkName: "Multi-Factor Authentication (MFA)",
    users: [],
    overallStatus: "FAILING",
    error: null,
    message: null,
  };

  try {
    const {
      data: { users },
      error: usersError,
    } = await supabase.auth.admin.listUsers();

    if (usersError) {
      logEvidence("error", "MFA check: Failed to list users.", {
        project: displayUrl,
        code: usersError.code,
        details: usersError.message,
      });
      throw usersError;
    }

    if (users && users.length > 0) {
      let allMfaEnabled = true;
      mfaResults.users = users.map((user) => {
        const isMfaEnabled =
          user.factors &&
          user.factors.some((factor) => factor.status === "verified");
        if (!isMfaEnabled) allMfaEnabled = false;
        return {
          id: user.id,
          email: user.email,
          phone: user.phone,
          mfa_enabled: isMfaEnabled,
        };
      });
      mfaResults.overallStatus = allMfaEnabled ? "PASSING" : "FAILING";
    } else {
      mfaResults.overallStatus = "N/A";
      mfaResults.message = "No users found in the project.";
    }
    logEvidence("info", "MFA check completed.", {
      project: displayUrl,
      status: mfaResults.overallStatus,
      count: users ? users.length : 0,
    });
  } catch (error) {
    mfaResults.error = error.message || JSON.stringify(error);
    mfaResults.overallStatus = "ERROR";
    logEvidence("error", "MFA check processing failed.", {
      project: displayUrl,
      error: mfaResults.error,
    });
  }

  return mfaResults;
}

async function runRLSCheck(connectionString) {
  console.log("[RLS][PG] Starting direct Postgres RLS check...");

  const pool = new Pool({
    connectionString,
    ssl: { rejectUnauthorized: false },
  });
  pool.on("error", (err) => {
    if (String(err).includes(":shutdown, :db_termination")) {
      // Optionally suppress or log at a lower level
      return;
    }
    console.error("[RLS][PG] Pool error event:", err);
  });
  const rlsResults = {
    checkName: "Row Level Security (RLS)",
    overallStatus: "PASSING",
    tables: [],
    error: null,
    message: null,
  };

  try {
    // Get all user tables in public schema
    const tablesRes = await pool.query(`
      SELECT tablename
      FROM pg_tables
      WHERE schemaname = 'public'
    `);
    const tableNames = tablesRes.rows.map((row) => row.tablename);
    console.log("[RLS][PG] Tables found:", tableNames);

    if (!tableNames.length) {
      rlsResults.overallStatus = "N/A";
      rlsResults.message = "No tables found in public schema.";
      await pool.end();
      return rlsResults;
    }

    let allHaveRLS = true;

    for (const table of tableNames) {
      // Check if RLS is enabled
      const rlsRes = await pool.query(
        `SELECT relrowsecurity FROM pg_class WHERE relname = $1`,
        [table]
      );
      const rlsEnabled = rlsRes.rows[0]?.relrowsecurity === true;
      if (!rlsEnabled) allHaveRLS = false;
      console.log(`[RLS][PG] Table "${table}" RLS enabled:`, rlsEnabled);

      // Fetch policies
      const policiesRes = await pool.query(
        `SELECT * FROM pg_policies WHERE tablename = $1`,
        [table]
      );
      const policies = policiesRes.rows;
      let policyCounts = { SELECT: 0, INSERT: 0, UPDATE: 0, DELETE: 0 };
      for (const policy of policies) {
        const cmd = policy.cmd?.toUpperCase();
        if (policyCounts.hasOwnProperty(cmd)) {
          policyCounts[cmd]++;
        }
      }

      rlsResults.tables.push({
        name: table,
        rls_enabled: rlsEnabled,
        recommendation: rlsEnabled
          ? null
          : "Enable RLS for this table to restrict access.",
        policy_counts: policyCounts,
        current_policies: policies,
      });
    }

    rlsResults.overallStatus = allHaveRLS ? "PASSING" : "FAILING";
    await pool.end();
    console.log("[RLS][PG] Final RLS results:", rlsResults);
    return rlsResults;
  } catch (error) {
    await pool.end();
    rlsResults.error = error.message;
    rlsResults.overallStatus = "ERROR";
    console.error("[RLS][PG] Error:", error);
    return rlsResults;
  }
}

async function runPITR(displayUrl) {
  const pitrResults = {
    checkName: "Point-in-Time Recovery (PITR)",
    status: "MANUAL_CHECK_REQUIRED",
    message: "Could not check PITR status via Management API.",
    details: {},
  };

  try {
    if (!MANAGEMENT_ACCESS_TOKEN) {
      throw new Error("Management API token (SUPABASE_PAT) is not configured");
    }

    const res = await fetch("https://api.supabase.com/v1/projects", {
      headers: {
        Authorization: `Bearer ${MANAGEMENT_ACCESS_TOKEN}`,
        Accept: "application/json",
      },
    });

    if (!res.ok) {
      const errorText = await res.text();
      throw new Error(`Failed to fetch projects: ${res.status} ${errorText}`);
    }

    const projects = await res.json();
    pitrResults.status = "PASSING";
    pitrResults.message = "PITR status checked for all projects.";
    pitrResults.details.projects = projects.map((project) => {
      const pitrAddon = project.addons?.find(
        (addon) => addon.type && addon.type.toLowerCase().includes("pitr")
      );
      const pitrEnabled = !!pitrAddon;
      console.log(project);
      return {
        name: project.name,
        ref: project.id,
        pitrEnabled,
        pitrAddon,
        status: pitrAddon?.status || "not_enabled",
        metadata: pitrAddon?.metadata || {},
      };
    });

    // If any project does not have PITR, mark as FAILING
    if (pitrResults.details.projects.some((p) => !p.pitrEnabled)) {
      pitrResults.status = "FAILING";
      pitrResults.message = "Some projects do not have PITR enabled.";
    }

    logEvidence("info", "PITR check completed", {
      project: displayUrl,
      status: pitrResults.status,
      projects: pitrResults.details.projects.map((p) => ({
        name: p.name,
        ref: p.ref,
        pitrEnabled: p.pitrEnabled,
      })),
    });
  } catch (err) {
    pitrResults.status = "ERROR";
    pitrResults.message = err.message;
    logEvidence("error", "PITR check failed", {
      project: displayUrl,
      error: err.message,
    });
  }

  return pitrResults;
}

app.post("/api/run-checks", async (req, res) => {
  const { projectUrl, serviceKey, dbConnectionString } = req.body;

  if (!projectUrl || !serviceKey) {
    logEvidence("error", "Missing Supabase credentials for check execution.");
    return res
      .status(400)
      .json({ error: "Supabase Project URL and Service Key are required." });
  }

  const displayUrl = projectUrl.includes("supabase.co")
    ? projectUrl.substring(0, projectUrl.indexOf(".")) + ".supabase.co"
    : projectUrl;
  logEvidence(
    "info",
    `Initiating compliance checks for project: ${displayUrl}`
  );

  try {
    console.log(projectUrl, serviceKey);
    const supabase = getSupabaseClient(projectUrl, serviceKey);

    // Run all checks
    const [mfaResults, rlsResults, pitrResults] = await Promise.all([
      runMFACheck(supabase, displayUrl),
      runRLSCheck(dbConnectionString),
      runPITR(displayUrl),
    ]);

    res.json({
      mfa: mfaResults,
      rls: rlsResults,
      pitr: pitrResults,
    });
  } catch (error) {
    logEvidence(
      "critical",
      "Critical error during Supabase client initialization or main check execution.",
      { error: error.message }
    );
    res.status(500).json({
      error: "Failed to connect to Supabase or run checks: " + error.message,
    });
  }
});

app.post("/api/fix-rls", async (req, res) => {
  const { projectUrl, serviceKey, tableName, dbConnectionString } = req.body;
  const displayUrl =
    projectUrl && projectUrl.includes("supabase.co")
      ? projectUrl.substring(0, projectUrl.indexOf(".")) + ".supabase.co"
      : projectUrl;

  if (!tableName) {
    return res.status(400).json({ error: "Table Name is required." });
  }

  // Otherwise, keep the existing logic for enabling RLS (direct DB connection)
  if (!projectUrl || !serviceKey) {
    logEvidence("error", "Missing parameters for RLS fix.");
    return res.status(400).json({
      error: "Project URL and Service Key are required.",
    });
  }

  // Dynamically construct the Postgres connection string from projectUrl and serviceKey
  try {
    const { Pool } = require("pg");
    const pool = new Pool({
      connectionString: dbConnectionString,
      ssl: { rejectUnauthorized: false },
    });
    await pool.query(
      `ALTER TABLE public."${tableName}" ENABLE ROW LEVEL SECURITY;`
    );
    // Insert a placeholder policy if none exist
    const { rows: existingPolicies } = await pool.query(
      `SELECT * FROM pg_policies WHERE tablename = $1`,
      [tableName]
    );
    if (existingPolicies.length === 0) {
      await pool.query(
        `CREATE POLICY "placeholder_policy" ON public."${tableName}" FOR SELECT USING (true);`
      );
    }
    await pool.end();
    const successMessage = `RLS successfully enabled for table: \"${tableName}\". A placeholder policy was added. Use the chat to generate more policies tailored to your needs!`;
    logEvidence("info", successMessage, { project: displayUrl, tableName });
    return res.json({ message: successMessage, tableName });
  } catch (error) {
    logEvidence(
      "error",
      `Failed to enable RLS for table: ${tableName} (direct DB)`,
      {
        error,
        errorType: typeof error,
        errorString: String(error),
        errorStack: error && error.stack,
      }
    );
    return res.status(500).json({
      error: `Failed to enable RLS for \"${tableName}\": ${String(error)}`,
      errorType: typeof error,
      errorString: String(error),
      errorStack: error && error.stack,
      errorObj: error,
    });
  }
});

app.post("/api/fix-mfa", async (req, res) => {
  const { projectUrl, serviceKey, userId } = req.body;
  const displayUrl = projectUrl.includes("supabase.co")
    ? projectUrl.substring(0, projectUrl.indexOf(".")) + ".supabase.co"
    : projectUrl;

  if (!projectUrl || !serviceKey || !userId) {
    logEvidence("error", "Missing parameters for MFA fix.");
    return res.status(400).json({
      error: "Project URL, Service Key, and User ID are required.",
    });
  }

  try {
    const supabase = getSupabaseClient(projectUrl, serviceKey);

    // First, check if the user exists
    const { data: userData, error: userError } =
      await supabase.auth.admin.getUserById(userId);

    if (userError) {
      logEvidence(
        "error",
        `Failed to find user: ${userId} on project ${displayUrl}`,
        {
          error: userError.message,
        }
      );
      throw userError;
    }

    if (!userData?.user?.email) {
      const error = new Error(
        "User email not found. Cannot enable MFA without an email address."
      );
      logEvidence("error", `Failed to enable MFA: ${error.message}`, {
        userId,
        userData,
      });
      throw error;
    }

    const userEmail = userData.user.email;

    // Send a password reset email
    const { error: resetError } = await supabase.auth.resetPasswordForEmail(
      userEmail,
      {
        redirectTo: `${projectUrl}/auth/reset-password?mfa_setup=true`,
      }
    );

    if (resetError) {
      logEvidence(
        "error",
        `Failed to send MFA setup email to user: ${userEmail}`,
        {
          error: resetError.message,
        }
      );
      throw resetError;
    }

    const successMessage = `A password reset email has been sent to ${userEmail}. When resetting the password, the user will be prompted to set up MFA.`;
    logEvidence("info", successMessage, { project: displayUrl, userId });
    res.json({
      message: successMessage,
      userId,
      email: userEmail,
    });
  } catch (error) {
    res.status(500).json({
      error: `Failed to enable MFA for user ${userId}: ${error.message}`,
    });
  }
});

app.post("/api/fix-pitr", async (req, res) => {
  const { projectUrl, serviceKey, projectRef } = req.body;
  const displayUrl = projectUrl.includes("supabase.co")
    ? projectUrl.substring(0, projectUrl.indexOf(".")) + ".supabase.co"
    : projectUrl;

  if (!projectUrl || !serviceKey || !projectRef) {
    logEvidence("error", "Missing parameters for PITR fix.");
    return res.status(400).json({
      error: "Project URL, Service Key, and Project Ref are required.",
    });
  }

  if (!MANAGEMENT_ACCESS_TOKEN) {
    logEvidence("error", "Management API token not configured");
    return res.status(500).json({
      error:
        "Management API token (SUPABASE_PAT) is not configured. Please set it in your environment variables.",
    });
  }

  try {
    // First check if PITR is already enabled
    const checkRes = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}`,
      {
        headers: {
          Authorization: `Bearer ${MANAGEMENT_ACCESS_TOKEN}`,
          Accept: "application/json",
        },
      }
    );

    if (!checkRes.ok) {
      const errorText = await checkRes.text();
      throw new Error(
        `Failed to check project status: ${checkRes.status} ${errorText}`
      );
    }

    const project = await checkRes.json();
    const pitrAddon = project.addons?.find(
      (addon) => addon.type && addon.type.toLowerCase().includes("pitr")
    );

    if (pitrAddon) {
      const successMessage = `PITR is already enabled for project: ${projectRef}.`;
      logEvidence("info", successMessage, { project: displayUrl, projectRef });
      return res.json({ message: successMessage, projectRef });
    }

    // Enable PITR via Supabase Management API
    const res = await fetch(
      `https://api.supabase.com/v1/projects/${projectRef}/addons`,
      {
        method: "PATCH",
        headers: {
          Authorization: `Bearer ${MANAGEMENT_ACCESS_TOKEN}`,
          Accept: "application/json",
          "Content-Type": "application/json",
        },
        body: JSON.stringify([
          {
            type: "pitr",
            options: {
              retention_period_days: 7, // Default to 7 days retention
            },
          },
        ]),
      }
    );

    if (!res.ok) {
      const errorText = await res.text();
      logEvidence("error", `Failed to enable PITR for project: ${projectRef}`, {
        error: errorText,
      });
      throw new Error(`Failed to enable PITR: ${errorText}`);
    }

    const successMessage = `PITR has been enabled for project: ${projectRef} with 7 days retention period. The changes may take a few minutes to take effect.`;
    logEvidence("info", successMessage, { project: displayUrl, projectRef });
    res.json({
      message: successMessage,
      projectRef,
    });
  } catch (error) {
    logEvidence("error", `Failed to enable PITR for project: ${projectRef}`, {
      error: error.message,
    });
    res.status(500).json({
      error: `Failed to enable PITR for project ${projectRef}: ${error.message}`,
    });
  }
});

app.post("/api/ai-assist", async (req, res) => {
  const { projectUrl, serviceKey, issue, context } = req.body;
  const displayUrl =
    projectUrl && projectUrl.includes("supabase.co")
      ? projectUrl.substring(0, projectUrl.indexOf(".")) + ".supabase.co"
      : projectUrl;

  if (!projectUrl || !serviceKey || !issue) {
    logEvidence("error", "Missing parameters for AI assistance.");
    return res.status(400).json({
      error: "Project URL, Service Key, and Issue description are required.",
    });
  }

  try {
    const openai = new OpenAI({
      apiKey: process.env.OPENAI_API_KEY,
    });

    // Just send the context and prompt as a single user message
    const userPrompt = `Context:\n${JSON.stringify(
      context,
      null,
      2
    )}\n\nPrompt:\n${issue}`;

    const completion = await openai.chat.completions.create({
      model: "gpt-4",
      messages: [
        {
          role: "system",
          content:
            "You are a Supabase compliance expert assistant. Answer the user's prompt using the provided context. Be concise, actionable, and clear. If SQL is needed, use markdown code blocks.",
        },
        {
          role: "user",
          content: userPrompt,
        },
      ],
      temperature: 0.7,
      max_tokens: 700,
    });

    const response = completion.choices[0].message.content;

    logEvidence("info", "AI compliance analysis provided", {
      project: displayUrl,
      analysisType: issue.substring(0, 100) + "...",
    });

    res.json({
      message: response,
      timestamp: new Date().toISOString(),
    });
  } catch (error) {
    logEvidence("error", "AI compliance analysis failed", {
      project: displayUrl,
      error: error.message,
    });
    res.status(500).json({
      error: `Failed to get AI compliance analysis: ${error.message}`,
    });
  }
});

app.get("/api/hello", (req, res) => {
  res.json({ message: "Hello, world!" });
});

app.listen(port, () => {
  logEvidence("info", `Delve backend server running on port ${port}`);
  console.log(`Backend server running on http://localhost:${port}`);
  try {
    fs.accessSync(__dirname, fs.constants.W_OK);
    logEvidence("info", `Evidence log will be written to: ${evidenceLogPath}`);
  } catch (err) {
    logEvidence(
      "error",
      `Evidence log directory is not writable: ${__dirname}. Logs will only go to console.`
    );
    console.error(
      `Error: Evidence log directory is not writable. Please check permissions for ${__dirname}`
    );
  }
});
