"use client";

import { useState, Fragment, useRef, useEffect } from "react";
import axios from "axios";
import { toast } from "sonner";

function getStatusPillClass(status) {
  if (status === "PASSING") return "bg-green-100 text-green-700";
  if (status === "FAILING") return "bg-red-100 text-red-700";
  if (status === "MANUAL_CHECK_REQUIRED" || status === "N/A")
    return "bg-yellow-100 text-yellow-700";
  if (status === "ERROR") return "bg-red-200 text-red-800";
  return "bg-slate-100 text-slate-700";
}

export default function HomePage() {
  const [projectUrl, setProjectUrl] = useState("");
  const [serviceKey, setServiceKey] = useState("");
  const [results, setResults] = useState(null);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState("");
  const [fixMessage, setFixMessage] = useState("");
  const [dbConnectionString, setDbConnectionString] = useState("");
  const [chatHistory, setChatHistory] = useState([]);
  const chatEndRef = useRef(null);
  const [isAiLoading, setIsAiLoading] = useState(false);
  const [rlsActionMessage, setRlsActionMessage] = useState("");
  const [hasMounted, setHasMounted] = useState(false);

  const backendUrl =
    process.env.NEXT_PUBLIC_BACKEND_URL || "http://localhost:3001";

  const handleSubmit = async (e) => {
    e.preventDefault();
    setIsLoading(true);
    setError("");
    setResults(null);
    setFixMessage("");

    if (!projectUrl.trim() || !serviceKey.trim()) {
      setError("Project URL and Service Key cannot be empty.");
      setIsLoading(false);
      return;
    }
    if (
      !projectUrl.startsWith("http://") &&
      !projectUrl.startsWith("https://")
    ) {
      setError("Project URL must start with http:// or https://");
      setIsLoading(false);
      return;
    }

    try {
      const response = await axios.post(`${backendUrl}/api/run-checks`, {
        projectUrl,
        serviceKey,
        dbConnectionString: dbConnectionString.trim() || undefined,
      });
      setResults(response.data);
    } catch (err) {
      setError(
        err.response?.data?.error ||
          err.message ||
          "Failed to fetch compliance status."
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFixRls = async (tableName) => {
    setIsLoading(true);
    setFixMessage("");
    setError("");
    try {
      const response = await axios.post(`${backendUrl}/api/fix-rls`, {
        projectUrl,
        serviceKey,
        tableName,
        dbConnectionString: dbConnectionString.trim() || undefined,
      });
      setFixMessage(
        response.data.message +
          " Consider re-running checks to see the updated status."
      );
    } catch (err) {
      setError(
        err.response?.data?.error || `Failed to fix RLS for ${tableName}.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFixMfa = async (userId) => {
    setIsLoading(true);
    setFixMessage("");
    setError("");
    try {
      const response = await axios.post(`${backendUrl}/api/fix-mfa`, {
        projectUrl,
        serviceKey,
        userId,
      });
      setFixMessage(
        response.data.message +
          " The user will need to complete the MFA setup process."
      );
    } catch (err) {
      setError(
        err.response?.data?.error || `Failed to enable MFA for user ${userId}.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleFixPitr = async (projectRef) => {
    setIsLoading(true);
    setFixMessage("");
    setError("");
    try {
      // Extract project reference from URL if not provided
      const ref =
        projectRef || projectUrl.replace(/^https?:\/\//, "").split(".")[0];

      const response = await axios.post(`${backendUrl}/api/fix-pitr`, {
        projectUrl,
        serviceKey,
        projectRef: ref,
      });
      setFixMessage(
        response.data.message +
          " The changes may take a few minutes to take effect."
      );
    } catch (err) {
      setError(
        err.response?.data?.error ||
          `Failed to enable PITR for project ${projectRef}.`
      );
    } finally {
      setIsLoading(false);
    }
  };

  const handleAiChat = async (message, context) => {
    setIsAiLoading(true);
    setError("");
    setChatHistory((prev) => [...prev, { role: "user", content: message }]);
    try {
      const response = await axios.post(`${backendUrl}/api/ai-assist`, {
        projectUrl,
        serviceKey,
        issue: message,
        context,
      });
      setChatHistory((prev) => [
        ...prev,
        { role: "assistant", content: response.data.message },
      ]);
    } catch (err) {
      setChatHistory((prev) => [
        ...prev,
        {
          role: "assistant",
          content: err.response?.data?.error || "Failed to get AI assistance.",
        },
      ]);
      console.log("[Chat] Error from /api/ai-assist:", err);
    } finally {
      setIsAiLoading(false);
    }
  };

  const getStatusColor = (status) => {
    if (status === "PASSING") return "text-green-600";
    if (status === "FAILING") return "text-red-600";
    if (status === "MANUAL_CHECK_REQUIRED" || status === "N/A")
      return "text-yellow-600";
    if (status === "ERROR") return "text-red-700 font-semibold";
    return "text-slate-500";
  };

  // Scroll to bottom on new chat message
  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }, [chatHistory, isAiLoading]);

  useEffect(() => {
    setHasMounted(true);
  }, []);

  // Show toast on error or fixMessage
  useEffect(() => {
    if (error) {
      toast.error(error, { duration: 6000 });
      setError(""); // Clear after showing
    }
    if (fixMessage) {
      toast.success(fixMessage, { duration: 6000 });
      setFixMessage(""); // Clear after showing
    }
  }, [error, fixMessage]);

  return (
    <div className="min-h-screen bg-slate-100 dark:bg-slate-900 py-8 px-4 sm:px-6 lg:px-8">
      <main className="max-w-3xl mx-auto">
        <div className="text-center mb-10">
          <h1 className="text-4xl font-bold text-blue-600 dark:text-blue-400">
            Delve 🛡️
          </h1>
          <p className="mt-2 text-lg text-slate-700 dark:text-slate-200">
            Supabase Compliance Checker
          </p>
        </div>

        <div className="bg-white dark:bg-slate-800 shadow-xl rounded-lg p-6 sm:p-8">
          <div className="mb-6 p-4 bg-yellow-50 dark:bg-yellow-900/30 border-l-4 border-yellow-400 dark:border-yellow-500 text-yellow-700 dark:text-yellow-200">
            <p className="font-bold">Important Security Notice:</p>
            <p>
              You will be asked for your Supabase Project URL and{" "}
              <code className="bg-yellow-100 dark:bg-yellow-800 px-1 rounded">
                service_role
              </code>{" "}
              key. This key grants administrative access to your project. Handle
              it with extreme care. Only use this tool with projects you
              own/manage and in a trusted environment. The key is sent to our
              backend for processing the checks.
            </p>
          </div>

          <form onSubmit={handleSubmit} className="space-y-6">
            <div>
              <label
                htmlFor="projectUrl"
                className="block text-sm font-medium text-slate-700"
              >
                Supabase Project URL
              </label>
              <input
                type="text"
                id="projectUrl"
                value={projectUrl}
                onChange={(e) => setProjectUrl(e.target.value)}
                placeholder="https://your-project-ref.supabase.co"
                required
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="serviceKey"
                className="block text-sm font-medium text-slate-700"
              >
                Supabase Service Role Key
              </label>
              <input
                type="password"
                id="serviceKey"
                value={serviceKey}
                onChange={(e) => setServiceKey(e.target.value)}
                placeholder="Enter your service_role key (kept confidential)"
                required
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <div>
              <label
                htmlFor="dbConnectionString"
                className="block text-sm font-medium text-slate-700"
              >
                Postgres Connection String (optional)
              </label>
              <input
                type="text"
                id="dbConnectionString"
                value={dbConnectionString}
                onChange={(e) => setDbConnectionString(e.target.value)}
                placeholder="postgresql://..."
                className="mt-1 block w-full px-3 py-2 border border-slate-300 rounded-md shadow-sm focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm"
              />
            </div>
            <button
              type="submit"
              disabled={isLoading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-slate-400 disabled:cursor-not-allowed"
            >
              {isLoading ? "Checking Compliance..." : "Run Compliance Checks"}
            </button>
          </form>
        </div>

        {/* Only render results after client has mounted to avoid hydration errors */}
        {hasMounted && results && (
          <div className="mt-8 bg-white dark:bg-slate-800 shadow-xl rounded-lg">
            <h2 className="text-2xl font-semibold text-slate-800 dark:text-slate-200 p-6 border-b border-slate-200 dark:border-slate-700">
              Compliance Report 📊
            </h2>
            <div className="divide-y divide-slate-200 dark:divide-slate-700">
              {/* MFA Results */}
              <CheckResultItem
                title={
                  results.mfa?.checkName || "Multi-Factor Authentication (MFA)"
                }
                error={results.mfa?.error}
              >
                {results.mfa?.users && results.mfa.users.length > 0 ? (
                  <div className="overflow-x-auto">
                    <table className="min-w-full text-sm border border-slate-200 dark:border-slate-700 rounded">
                      <thead>
                        <tr className="bg-slate-100 dark:bg-slate-800">
                          <th className="px-3 py-2 text-left font-semibold">
                            Email
                          </th>
                          <th className="px-3 py-2 text-left font-semibold">
                            Phone
                          </th>
                          <th className="px-3 py-2 text-left font-semibold">
                            MFA Enabled
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {results.mfa.users.map((user) => (
                          <tr
                            key={user.id}
                            className="border-t border-slate-200 dark:border-slate-700"
                          >
                            <td className="px-3 py-1 font-mono">
                              {user.email || (
                                <span className="italic text-slate-400">
                                  (none)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1 font-mono">
                              {user.phone || (
                                <span className="italic text-slate-400">
                                  (none)
                                </span>
                              )}
                            </td>
                            <td className="px-3 py-1">
                              {user.mfa_enabled ? (
                                <span className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-200 border border-green-200 dark:border-green-700">
                                    Yes
                                  </span>
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800 border border-green-300 ml-1">
                                    Passing
                                  </span>
                                </span>
                              ) : (
                                <div className="flex items-center gap-2">
                                  <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200 border border-red-200 dark:border-red-700">
                                    Failing
                                  </span>
                                  <button
                                    className="px-2 py-0.5 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800 text-xs disabled:opacity-50 disabled:cursor-not-allowed"
                                    onClick={() => handleFixMfa(user.id)}
                                    disabled={isLoading || !user.email}
                                    title={
                                      !user.email
                                        ? "Cannot enable MFA without an email address"
                                        : "Enable MFA"
                                    }
                                  >
                                    Enable MFA
                                  </button>
                                </div>
                              )}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                ) : (
                  <div className="text-slate-500 dark:text-slate-300">
                    No users found.
                  </div>
                )}
              </CheckResultItem>
              {/* RLS Results */}
              <CheckResultItem
                title={results.rls?.checkName || "Row Level Security (RLS)"}
                error={results.rls?.error}
              >
                {results.rls?.tables && results.rls.tables.length > 0 ? (
                  <div className="space-y-4">
                    {results.rls.tables.map((table) => (
                      <div
                        key={table.name}
                        className={`border rounded p-3 mb-2 ${
                          table.rls_enabled
                            ? "bg-green-50 dark:bg-green-900/30 border-green-200 dark:border-green-700"
                            : "bg-red-50 dark:bg-red-900/40 border-red-200 dark:border-red-700"
                        }`}
                      >
                        <div
                          className={`font-semibold flex items-center gap-2 ${
                            table.rls_enabled
                              ? "text-green-700 dark:text-green-200"
                              : "text-red-700 dark:text-red-200"
                          }`}
                        >
                          Table: <span className="font-mono">{table.name}</span>
                          {table.is_empty && (
                            <span className="ml-2 px-2 py-0.5 rounded-full text-xs bg-slate-200 dark:bg-slate-700 text-slate-700 dark:text-slate-200">
                              Empty
                            </span>
                          )}
                          {table.rls_enabled ? (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800 border border-green-300 ml-1">
                              Passing
                            </span>
                          ) : (
                            <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200 border border-red-200 dark:border-red-700 ml-1">
                              Failing
                            </span>
                          )}
                        </div>
                        {table.error && (
                          <div className="text-xs text-red-500 dark:text-red-300 mb-1">
                            Error: {table.error}
                          </div>
                        )}
                        <div className="text-sm text-slate-700 dark:text-slate-200 mb-1">
                          <span className="font-bold">Current Policies:</span>{" "}
                          {table.current_policies &&
                          table.current_policies.length > 0 ? (
                            <ul className="list-disc ml-5">
                              {table.current_policies.map((p) => (
                                <li key={p.name + p.cmd}>
                                  <span className="font-mono">{p.name}</span> (
                                  {p.cmd}) - Roles:{" "}
                                  {Array.isArray(p.roles)
                                    ? p.roles.join(", ")
                                    : p.roles || "All"}
                                </li>
                              ))}
                            </ul>
                          ) : (
                            "None"
                          )}
                        </div>
                        <div className="flex flex-wrap gap-2 mb-1">
                          {Object.entries(table.policy_counts || {}).map(
                            ([cmd, count]) => (
                              <span
                                key={cmd}
                                className="px-2 py-0.5 rounded-full text-xs bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700"
                              >
                                {cmd}: {count}
                              </span>
                            )
                          )}
                        </div>
                        <div className="text-sm text-slate-700 dark:text-slate-200">
                          <span className="font-bold">Recommendations:</span>
                          <ul className="list-disc ml-5">
                            {table.recommendations?.map((rec, i) => (
                              <li key={i}>{rec}</li>
                            ))}
                          </ul>
                        </div>
                        {!table.rls_enabled && (
                          <div className="mt-2 flex flex-col gap-1">
                            <div className="flex gap-2">
                              <button
                                className="px-3 py-1 bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-800 text-xs"
                                onClick={() => handleFixRls(table.name)}
                                title="Enable RLS for this table using a direct SQL command."
                                disabled={isLoading}
                              >
                                Enable RLS (SQL)
                              </button>
                              <button
                                className="px-3 py-1 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800 text-xs"
                                onClick={() => {
                                  const projectRef = projectUrl
                                    .replace(/^https?:\/\//, "")
                                    .split(".")[0];
                                  window.open(
                                    `https://supabase.com/dashboard/project/${projectRef}/auth/policies`,
                                    "_blank"
                                  );
                                }}
                                title="Open the Supabase Dashboard to enable RLS manually."
                              >
                                Open RLS Settings in Dashboard
                              </button>
                            </div>
                            <span className="text-xs text-slate-500 dark:text-slate-300">
                              For security reasons, enabling RLS can be done
                              either programmatically (SQL) or manually in the
                              Supabase Dashboard. The SQL button uses your
                              credentials to enable RLS directly; the Dashboard
                              button opens the manual settings page.
                            </span>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                ) : (
                  <div className="text-slate-500">No tables found.</div>
                )}
              </CheckResultItem>
              {/* PITR Results */}
              <CheckResultItem
                title={
                  results.pitr?.checkName || "Point-in-Time Recovery (PITR)"
                }
                error={results.pitr?.error}
              >
                <div className="text-slate-700 dark:text-slate-200">
                  {results.pitr?.message && (
                    <div className="mb-2">{results.pitr.message}</div>
                  )}
                  {results.pitr?.details?.projects &&
                  results.pitr.details.projects.length > 0 ? (
                    <div className="overflow-x-auto">
                      <table className="min-w-full text-sm border border-slate-200 dark:border-slate-700 rounded">
                        <thead>
                          <tr className="bg-slate-100 dark:bg-slate-800">
                            <th className="px-3 py-2 text-left font-semibold">
                              Project Name
                            </th>
                            <th className="px-3 py-2 text-left font-semibold">
                              Ref
                            </th>
                            <th className="px-3 py-2 text-left font-semibold">
                              PITR Enabled
                            </th>
                            <th className="px-3 py-2 text-left font-semibold">
                              Addon Details
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {results.pitr.details.projects.map((project) => (
                            <tr
                              key={project.ref}
                              className="border-t border-slate-200 dark:border-slate-700"
                            >
                              <td className="px-3 py-1 font-mono">
                                {project.name}
                              </td>
                              <td className="px-3 py-1 font-mono">
                                {project.ref}
                              </td>
                              <td className="px-3 py-1">
                                {project.pitrEnabled ? (
                                  <span className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-200 border border-green-200 dark:border-green-700">
                                      Yes
                                    </span>
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-green-200 text-green-800 border border-green-300 ml-1">
                                      Passing
                                    </span>
                                  </span>
                                ) : (
                                  <span className="flex items-center gap-2">
                                    <span className="px-2 py-0.5 rounded-full text-xs bg-red-100 dark:bg-red-900/30 text-red-700 dark:text-red-200 border border-red-200 dark:border-red-700">
                                      Failing
                                    </span>
                                    {/* Only show buttons when PITR is failing */}
                                    <div className="flex gap-2">
                                      <button
                                        className="px-2 py-0.5 bg-green-600 dark:bg-green-700 text-white rounded hover:bg-green-700 dark:hover:bg-green-800 text-xs"
                                        onClick={() =>
                                          handleFixPitr(project.ref)
                                        }
                                        disabled={isLoading}
                                      >
                                        Try Enable PITR (API)
                                      </button>
                                      <button
                                        className="px-2 py-0.5 bg-blue-600 dark:bg-blue-700 text-white rounded hover:bg-blue-700 dark:hover:bg-blue-800 text-xs"
                                        onClick={() =>
                                          window.open(
                                            `https://app.supabase.com/project/${project.ref}/database/backups/pitr`,
                                            "_blank"
                                          )
                                        }
                                      >
                                        Enable PITR (Dashboard)
                                      </button>
                                    </div>
                                  </span>
                                )}
                              </td>
                              <td className="px-3 py-1 text-xs">
                                {project.pitrAddon ? (
                                  JSON.stringify(project.pitrAddon)
                                ) : (
                                  <span className="italic text-slate-400">
                                    None
                                  </span>
                                )}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="text-slate-500 dark:text-slate-300">
                      No project details found.
                    </div>
                  )}
                </div>
              </CheckResultItem>
            </div>
          </div>
        )}

        {/* Chat interface */}
        <div className="mt-8 p-4 bg-white dark:bg-slate-800 rounded-lg shadow">
          <h2 className="text-lg font-semibold mb-4">Compliance Assistant</h2>
          <div className="space-y-4">
            <div className="h-96 overflow-y-auto border border-slate-200 dark:border-slate-700 rounded-lg p-4 bg-slate-50 dark:bg-slate-900">
              {chatHistory.length === 0 ? (
                <div className="text-slate-500 dark:text-slate-400 h-full flex items-center justify-center">
                  {results ? (
                    <div className="text-center">
                      <p>Ask me about your compliance status, for example:</p>
                      <ul className="mt-2 text-sm space-y-1">
                        <li>
                          &quot;What&apos;s my current compliance status?&quot;
                        </li>
                        <li>&quot;Generate RLS policies for my tables&quot;</li>
                        <li>&quot;Create a compliance documentation&quot;</li>
                        <li>&quot;Why did my MFA check fail?&quot;</li>
                      </ul>
                    </div>
                  ) : (
                    <p>Run compliance checks first to get started</p>
                  )}
                </div>
              ) : (
                <div className="flex flex-col gap-4">
                  {chatHistory.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`flex ${
                        msg.role === "user" ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-xl px-4 py-2 rounded-lg shadow text-sm whitespace-pre-wrap prose dark:prose-invert ${
                          msg.role === "user"
                            ? "bg-blue-600 text-white dark:bg-blue-700"
                            : "bg-slate-200 dark:bg-slate-700 text-slate-900 dark:text-slate-100"
                        }`}
                        style={{ overflowX: "auto" }}
                      >
                        {msg.content}
                        {/* If assistant and SQL, show RLS apply button */}
                        {msg.role === "assistant" &&
                          msg.content.includes("```sql") && (
                            <div className="mt-2">
                              <button
                                onClick={() => {
                                  // Extract table names from the SQL policies
                                  const tableNames = msg.content
                                    .match(/```sql\n([\s\S]*?)```/g)
                                    ?.map((block) => {
                                      const match = block.match(
                                        /ALTER TABLE "([^"]+)"/
                                      );
                                      return match ? match[1] : null;
                                    })
                                    .filter(Boolean);
                                  tableNames?.forEach((tableName) => {
                                    handleFixRls(tableName);
                                  });
                                }}
                                className="px-3 py-1 bg-green-600 text-white rounded hover:bg-green-700 text-xs mt-2"
                              >
                                Apply RLS Policies
                              </button>
                            </div>
                          )}
                      </div>
                    </div>
                  ))}
                  <div ref={chatEndRef} />
                </div>
              )}
            </div>
            <form
              onSubmit={(e) => {
                e.preventDefault();
                const input = e.target.elements.message;
                if (input.value.trim()) {
                  handleAiChat(input.value, {
                    results,
                    systemContext: {
                      projectUrl,
                      hasServiceKey: !!serviceKey,
                      checksRun: !!results,
                      mfaStatus: results?.mfa?.overallStatus,
                      rlsStatus: results?.rls?.overallStatus,
                      pitrStatus: results?.pitr?.status,
                      tables: results?.rls?.tables?.map((t) => ({
                        name: t.name,
                        rls_enabled: t.rls_enabled,
                        current_policies: t.current_policies,
                      })),
                    },
                  });
                  input.value = "";
                }
              }}
              className="flex gap-2"
            >
              <input
                type="text"
                name="message"
                placeholder="Ask about your compliance status..."
                disabled={isAiLoading || !results}
                className="flex-1 px-4 py-2 border border-slate-300 dark:border-slate-600 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 dark:bg-slate-800 dark:text-white"
                autoComplete="off"
              />
              <button
                type="submit"
                disabled={isAiLoading || !results}
                className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50"
              >
                {isAiLoading ? "Thinking..." : "Send"}
              </button>
            </form>
          </div>
        </div>

        {rlsActionMessage && (
          <div className="mt-2 text-sm text-blue-700 dark:text-blue-200">
            {rlsActionMessage}
          </div>
        )}
      </main>
    </div>
  );
}

function CheckResultItem({ title, error, children }) {
  return (
    <div className="p-6">
      <div className="flex items-center justify-between mb-2">
        <h3 className="text-lg font-semibold">{title}</h3>
      </div>
      {error ? (
        <div className="text-red-600 text-sm mb-2">
          Error: {typeof error === "object" ? JSON.stringify(error) : error}
        </div>
      ) : (
        <div className="mb-2">{children}</div>
      )}
    </div>
  );
}
