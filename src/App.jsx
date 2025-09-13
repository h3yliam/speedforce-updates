import React, { useState, useEffect, useRef } from 'react';
import { createClient } from '@supabase/supabase-js';

/*
 * This version of the Daily Mail update tracker uses Supabase for
 * persistence instead of localStorage. It supports per‑user login,
 * threaded updates with nested replies, category/description/status
 * metadata, Excel/TSV table paste handling, a summary list of the
 * latest updates, and collapsing/expanding of past updates. Each
 * update is stored in the `entries` table and each user in the
 * `users` table with foreign keys linking entries back to their
 * author and parent entry. Set the following environment variables in
 * your Vercel project to connect this app to Supabase:
 *
 *   VITE_SUPABASE_URL – your Supabase project URL
 *   VITE_SUPABASE_ANON_KEY – your Supabase anon API key
 */

// Initialise the Supabase client using environment variables. When
// running locally with Vite, ensure you set VITE_SUPABASE_URL and
// VITE_SUPABASE_ANON_KEY in a `.env` file. In production, define
// these variables in your deployment environment.
const supabase = createClient(
  import.meta.env.VITE_SUPABASE_URL,
  import.meta.env.VITE_SUPABASE_ANON_KEY
);

// Helper to build a tree of entries from a flat list of rows. Each
// entry will gain a `children` array holding its replies as well as
// UI state flags used by the components (e.g. showHistory).
function buildThreadHierarchy(rows) {
  const map = {};
  const roots = [];
  rows.forEach((row) => {
    map[row.id] = {
      ...row,
      children: [],
      showHistory: false,
    };
  });
  rows.forEach((row) => {
    const node = map[row.id];
    if (row.parent_id) {
      const parent = map[row.parent_id];
      if (parent) parent.children.push(node);
    } else {
      roots.push(node);
    }
  });
  return roots;
}

// Compute the latest activity within a thread. Walks the entry and
// its descendants to find the most recent created_at or updated_at
// timestamp. Returns the timestamp, the initials of the user who made
// that update and the corresponding HTML. Used to sort and display
// summaries.
function getLastDetails(entry) {
  let latestTime = entry.updated_at || entry.created_at;
  let lastBy = entry.initials;
  let lastHtml = entry.html;
  if (entry.children && entry.children.length > 0) {
    entry.children.forEach((child) => {
      const details = getLastDetails(child);
      if (new Date(details.latestTime) > new Date(latestTime)) {
        latestTime = details.latestTime;
        lastBy = details.lastBy;
        lastHtml = details.lastHtml;
      }
    });
  }
  return { latestTime, lastBy, lastHtml };
}

export default function App() {
  // Logged‑in user object { id, initials, name } or null if not logged in
  const [currentUser, setCurrentUser] = useState(null);
  // Temporary state for the login form
  const [loginInitials, setLoginInitials] = useState('');
  const [loginName, setLoginName] = useState('');
  // Users list fetched from Supabase
  const [users, setUsers] = useState([]);
  // Top level entries with nested children
  const [entries, setEntries] = useState([]);
  // Form fields for new updates
  const [category, setCategory] = useState('RFQ');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('New');
  // Which view to show: 'threads' or 'all'
  const [view, setView] = useState('threads');
  // If set, the threads view will scroll the entry with this id into view
  const [scrollToEntryId, setScrollToEntryId] = useState(null);
  // Ref for the main message input
  const messageRef = useRef(null);

  // Fetch users and entries from Supabase when the component mounts
  useEffect(() => {
    async function load() {
      const { data: usersData, error: usersError } = await supabase
        .from('users')
        .select('*')
        .order('created_at', { ascending: true });
      if (!usersError) {
        setUsers(usersData || []);
      } else {
        console.error('Error fetching users', usersError);
      }
      const { data: entriesData, error: entriesError } = await supabase
        .from('entries')
        .select('*')
        .order('created_at', { ascending: true });
      if (!entriesError) {
        // Enrich each entry with the author's initials for display convenience
        const userLookup = {};
        (usersData || []).forEach((u) => {
          userLookup[u.id] = u;
        });
        const enriched = (entriesData || []).map((row) => ({
          ...row,
          initials: userLookup[row.user_id]?.initials || '',
          name: userLookup[row.user_id]?.name || '',
        }));
        setEntries(buildThreadHierarchy(enriched));
      } else {
        console.error('Error fetching entries', entriesError);
      }
    }
    load();
  }, []);

  // When we switch to the threads view and have a scroll target, scroll that entry into view
  useEffect(() => {
    if (view === 'threads' && scrollToEntryId) {
      const el = document.getElementById(`entry-${scrollToEntryId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setScrollToEntryId(null);
    }
  }, [view, scrollToEntryId]);

  // Return the full name for a set of initials. Used for display in the
  // summary lists. Falls back to initials if the user isn't found.
  function getUserName(initials) {
    const user = users.find((u) => u.initials === initials);
    return user ? user.name || user.initials : initials;
  }

  // Colour palettes for category and status badges
  const categoryColors = {
    RFQ: '#007bff',
    PO: '#28a745',
    ETA: '#ffc107',
    CLAIM: '#17a2b8',
  };
  const statusColors = {
    New: '#6c757d',
    'In Progress': '#007bff',
    Complete: '#28a745',
    Cancelled: '#dc3545',
  };

  // Escape HTML for plain text conversion. Prevents injection when
  // converting TSV to table markup.
  function escapeHtml(str) {
    return str
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;');
  }

  // Convert tab separated values into an HTML table. Used when
  // detecting a pasted TSV in the message input.
  function tsvToHtml(text) {
    if (!/\t/.test(text)) {
      return text
        .split(/\r?\n/)
        .filter(Boolean)
        .map((line) => '<p>' + escapeHtml(line) + '</p>')
        .join('');
    }
    const rows = text.split(/\r?\n/).filter(Boolean);
    const tableRows = rows
      .map((row) => {
        const cols = row.split('\t');
        const cells = cols
          .map((col) => `<td style="border: 1px solid #ccc; padding: 4px;">${escapeHtml(col)}</td>`)
          .join('');
        return '<tr>' + cells + '</tr>';
      })
      .join('');
    return `<table style="border-collapse: collapse;">${tableRows}</table>`;
  }

  // Handle paste events on the main message input. Supports pasting
  // HTML tables from Excel and TSV plain text. Sanitises the pasted
  // table and inserts it into the editable div. Updates the html
  // state accordingly.
  const handlePaste = (e) => {
    const clipboardData = e.clipboardData;
    const htmlData = clipboardData.getData('text/html');
    if (htmlData && /<table/i.test(htmlData)) {
      e.preventDefault();
      let tableHtml;
      try {
        const parser = new DOMParser();
        const doc = parser.parseFromString(htmlData, 'text/html');
        const table = doc.querySelector('table');
        tableHtml = table ? table.outerHTML : null;
      } catch (err) {
        tableHtml = null;
      }
      if (!tableHtml) {
        const match = htmlData.match(/<table[\s\S]*?<\/table>/i);
        tableHtml = match ? match[0] : htmlData;
      }
      tableHtml = tableHtml.replace(/<col[^>]*>/gi, '');
      tableHtml = tableHtml.replace(/<tr[^>]*>/gi, '<tr>');
      tableHtml = tableHtml.replace(/<table[^>]*>/i, '<table style="border-collapse: collapse;">');
      tableHtml = tableHtml.replace(/<td[^>]*>/gi, '<td style="border: 1px solid #ccc; padding: 4px;">');
      if (messageRef.current) {
        document.execCommand('insertHTML', false, tableHtml);
      }
      return;
    }
    const plain = clipboardData.getData('text/plain');
    if (plain && /\t/.test(plain)) {
      e.preventDefault();
      const tableHtml = tsvToHtml(plain);
      if (messageRef.current) {
        document.execCommand('insertHTML', false, tableHtml);
      }
    }
  };

  // Log in as an existing user or create a new user if initials are
  // unknown. Requires the name for new users. Clears the login
  // fields on success.
  async function handleLogin() {
    const initials = loginInitials.trim();
    if (!initials) return;
    let user = users.find((u) => u.initials === initials);
    if (!user) {
      const name = loginName.trim();
      if (!name) return;
      const { data, error } = await supabase
        .from('users')
        .insert({ initials, name })
        .select()
        .single();
      if (error) {
        console.error('Error creating user', error);
        return;
      }
      user = data;
      setUsers((prev) => [...prev, user]);
    }
    setCurrentUser(user);
    setLoginInitials('');
    setLoginName('');
  }

  // Log out the current user
  function handleLogout() {
    setCurrentUser(null);
  }

  // Recursively search for an entry by id within the tree. Returns the
  // entry if found, otherwise undefined.
  function findEntry(entriesList, id) {
    for (const entry of entriesList) {
      if (entry.id === id) return entry;
      if (entry.children) {
        const found = findEntry(entry.children, id);
        if (found) return found;
      }
    }
    return undefined;
  }

  // Add a new entry or reply. When adding a reply, the category and
  // description inherit from the parent entry. After inserting into
  // Supabase, refresh the local entries by reloading data.
  async function addEntry(parentId = null, entryHtml = null, entryStatus = null) {
    const html = entryHtml !== null ? entryHtml : messageRef.current?.innerHTML || '';
    if (!html.trim()) return;
    if (!currentUser) return;
    let newCategory = category;
    let newDescription = description;
    let newStatus = entryStatus || status;
    if (parentId) {
      const parent = findEntry(entries, parentId);
      if (parent) {
        newCategory = parent.category;
        newDescription = parent.description;
        newStatus = parent.status;
      }
    }
    const { data, error } = await supabase
      .from('entries')
      .insert({
        parent_id: parentId,
        user_id: currentUser.id,
        category: newCategory,
        description: newDescription,
        status: newStatus,
        html: html,
      })
      .select()
      .single();
    if (error) {
      console.error('Error inserting entry', error);
    } else if (data) {
      // Reload data to incorporate the new entry into the hierarchy
      const { data: entriesData, error: entriesError } = await supabase
        .from('entries')
        .select('*')
        .order('created_at', { ascending: true });
      if (!entriesError) {
        const userLookup = {};
        users.forEach((u) => {
          userLookup[u.id] = u;
        });
        const enriched = (entriesData || []).map((row) => ({
          ...row,
          initials: userLookup[row.user_id]?.initials || '',
          name: userLookup[row.user_id]?.name || '',
        }));
        setEntries(buildThreadHierarchy(enriched));
      }
      // Clear the form fields when adding a top‑level entry
      if (!parentId) {
        setDescription('');
        if (messageRef.current) messageRef.current.innerHTML = '';
      }
    }
  }

  // Update an entry's HTML or status. If the status changes, pass the
  // new status; otherwise pass undefined. After updating, reload
  // entries to reflect changes.
  async function updateEntry(id, newHtml, newStatus) {
    const updates = {};
    if (newHtml !== undefined) updates.html = newHtml;
    if (newStatus !== undefined) updates.status = newStatus;
    updates.updated_at = new Date().toISOString();
    const { error } = await supabase
      .from('entries')
      .update(updates)
      .eq('id', id);
    if (error) {
      console.error('Error updating entry', error);
    } else {
      // Reload data to update local state
      const { data: entriesData, error: entriesError } = await supabase
        .from('entries')
        .select('*')
        .order('created_at', { ascending: true });
      if (!entriesError) {
        const userLookup = {};
        users.forEach((u) => {
          userLookup[u.id] = u;
        });
        const enriched = (entriesData || []).map((row) => ({
          ...row,
          initials: userLookup[row.user_id]?.initials || '',
          name: userLookup[row.user_id]?.name || '',
        }));
        setEntries(buildThreadHierarchy(enriched));
      }
    }
  }

  // Component to render an individual entry and its children. Handles
  // collapsed view at depth zero (show only the latest update) and
  // editing/replying functionality.
  function EntryComponent({ entry, depth }) {
    const [editing, setEditing] = useState(false);
    const [editHtml, setEditHtml] = useState(entry.html);
    const [editStatus, setEditStatus] = useState(entry.status);
    const [replying, setReplying] = useState(false);
    const replyRef = useRef(null);

    // Paste handler reused for reply and edit inputs
    const handleReplyPaste = handlePaste;

    const saveEdit = async () => {
      await updateEntry(entry.id, editHtml, editStatus);
      setEditing(false);
    };

    const saveReply = async () => {
      const html = replyRef.current?.innerHTML || '';
      if (!html.trim()) return;
      await addEntry(entry.id, html, null);
      setReplying(false);
    };

    const toggleHistory = () => {
      entry.showHistory = !entry.showHistory;
      // Trigger a re-render by updating state
      setEntries([...entries]);
    };

    // Determine if we should show the collapsed view: only for top level
    // entries (depth === 0) and when the entry is collapsed (showHistory false)
    const showCollapsed = depth === 0 && !entry.showHistory;

    return (
      <div
        id={`entry-${entry.id}`}
        style={{
          marginLeft: depth * 20,
          border: depth === 0 ? '1px solid #ddd' : '1px solid #eee',
          borderTop: depth === 0 ? '2px solid #999' : undefined,
          padding: '8px',
          marginTop: '8px',
        }}
      >
        {showCollapsed ? (
          <div>
            <div>
              <strong>
                <span
                  style={{
                    backgroundColor: categoryColors[entry.category],
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    marginRight: '4px',
                    fontSize: '0.8em',
                  }}
                >
                  {entry.category}
                </span>
                {entry.description}
              </strong>
            </div>
            <div style={{ fontSize: '0.8em', color: '#555' }}>
              {getUserName(entry.initials)} -{' '}
              {new Date(entry.updated_at || entry.created_at).toLocaleString()}
            </div>
            <div dangerouslySetInnerHTML={{ __html: entry.html }} />
            <button onClick={toggleHistory}>Show past updates</button>
          </div>
        ) : (
          <div>
            {depth === 0 && (
              <div>
                <strong>
                  <span
                    style={{
                      backgroundColor: categoryColors[entry.category],
                      color: 'white',
                      padding: '2px 6px',
                      borderRadius: '4px',
                      marginRight: '4px',
                      fontSize: '0.8em',
                    }}
                  >
                    {entry.category}
                  </span>
                  {entry.description}
                </strong>
                <span
                  style={{
                    backgroundColor: statusColors[entry.status],
                    color: 'white',
                    padding: '2px 6px',
                    borderRadius: '4px',
                    marginLeft: '8px',
                    fontSize: '0.8em',
                  }}
                >
                  {entry.status}
                </span>
              </div>
            )}
            <div style={{ fontSize: '0.8em', color: '#555' }}>
              {getUserName(entry.initials)} -{' '}
              {new Date(entry.updated_at || entry.created_at).toLocaleString()}{' '}
              {entry.updated_at && entry.updated_at !== entry.created_at && <em>(edited)</em>}
            </div>
            {editing ? (
              <div style={{ marginTop: '4px' }}>
                <select
                  value={editStatus}
                  onChange={(e) => setEditStatus(e.target.value)}
                  style={{ marginRight: '8px' }}
                >
                  {Object.keys(statusColors).map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
                <div
                  ref={replyRef}
                  contentEditable
                  suppressContentEditableWarning
                  style={{ border: '1px solid #ccc', padding: '4px', minHeight: '80px', marginTop: '4px' }}
                  onInput={() => setEditHtml(replyRef.current.innerHTML)}
                  onPaste={handleReplyPaste}
                  dangerouslySetInnerHTML={{ __html: editHtml }}
                />
                <button onClick={saveEdit}>Save</button>
                <button onClick={() => setEditing(false)} style={{ marginLeft: '8px' }}>
                  Cancel
                </button>
              </div>
            ) : (
              <div style={{ marginTop: '4px' }} dangerouslySetInnerHTML={{ __html: entry.html }} />
            )}
            {!editing && currentUser && entry.user_id === currentUser.id && (
              <button onClick={() => {
                setEditing(true);
                setEditHtml(entry.html);
                setEditStatus(entry.status);
              }}>
                Edit
              </button>
            )}
            {!editing && currentUser && (
              <button onClick={() => setReplying(!replying)} style={{ marginLeft: '8px' }}>
                {replying ? 'Cancel Reply' : 'Reply'}
              </button>
            )}
            {replying && currentUser && (
              <div style={{ marginTop: '4px' }}>
                <div
                  ref={replyRef}
                  contentEditable
                  suppressContentEditableWarning
                  style={{ border: '1px solid #ccc', padding: '4px', minHeight: '80px' }}
                  onPaste={handleReplyPaste}
                />
                <button onClick={saveReply}>Save Reply</button>
              </div>
            )}
            {/* Render children */}
            {entry.children &&
              entry.children.map((child) => (
                <EntryComponent key={child.id} entry={child} depth={depth + 1} />
              ))}
            {depth === 0 && (
              <div>
                <button onClick={toggleHistory} style={{ marginTop: '4px' }}>
                  {entry.showHistory ? 'Hide past updates' : 'Show past updates'}
                </button>
              </div>
            )}
          </div>
        )}
      </div>
    );
  }

  // Build the summary list from top level entries. Each summary object
  // contains the id, category, description, status, latest activity
  // timestamp and the initials of the user who made that update. Used
  // by both the overview grid and the All Updates page.
  const summaries = entries
    .map((entry) => {
      const { latestTime, lastBy } = getLastDetails(entry);
      return {
        id: entry.id,
        category: entry.category,
        description: entry.description,
        status: entry.status,
        latestTime,
        lastBy,
      };
    })
    .sort((a, b) => new Date(b.latestTime) - new Date(a.latestTime));

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <h1>Daily Mail</h1>
      {currentUser ? (
        <div>
          <div style={{ marginBottom: '8px' }}>
            Logged in as {currentUser.name} ({currentUser.initials}){' '}
            <button onClick={handleLogout}>Logout</button>
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
            <label>
              Category:{' '}
              <select
                value={category}
                onChange={(e) => setCategory(e.target.value)}
                style={{ marginLeft: '4px' }}
              >
                {Object.keys(categoryColors).map((c) => (
                  <option key={c} value={c}>
                    {c}
                  </option>
                ))}
              </select>
            </label>
            <input
              type="text"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              placeholder="Description"
              style={{ flex: '1 1 200px' }}
            />
            <label>
              Status:{' '}
              <select
                value={status}
                onChange={(e) => setStatus(e.target.value)}
                style={{ marginLeft: '4px' }}
              >
                {Object.keys(statusColors).map((s) => (
                  <option key={s} value={s}>
                    {s}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div
            ref={messageRef}
            contentEditable
            suppressContentEditableWarning
            onPaste={handlePaste}
            style={{
              border: '1px solid #ccc',
              padding: '8px',
              minHeight: '100px',
              marginTop: '8px',
            }}
          />
          <button
            onClick={() => addEntry(null)}
            disabled={!currentUser}
            style={{ marginTop: '8px' }}
          >
            Save
          </button>
          <div style={{ marginTop: '16px' }}>
            <button
              onClick={() => setView('threads')}
              disabled={view === 'threads'}
            >
              Threads
            </button>
            <button
              onClick={() => setView('all')}
              disabled={view === 'all'}
              style={{ marginLeft: '8px' }}
            >
              All Updates
            </button>
          </div>
          {view === 'threads' ? (
            <div>
              {/* Overview grid at top of threads view */}
              <div style={{ marginTop: '16px', border: '1px solid #ddd' }}>
                <div
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '2fr 1fr 1fr',
                    background: '#f5f5f5',
                    padding: '8px',
                    fontWeight: 'bold',
                  }}
                >
                  <div>Item</div>
                  <div>Status</div>
                  <div>Last update</div>
                </div>
                {summaries.map((summary) => (
                  <div
                    key={summary.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1fr 1fr',
                      borderTop: '1px solid #eee',
                      padding: '8px',
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                    onClick={() => {
                      setView('threads');
                      setScrollToEntryId(summary.id);
                    }}
                  >
                    <div>
                      <span
                        style={{
                          backgroundColor: categoryColors[summary.category],
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          marginRight: '4px',
                          fontSize: '0.8em',
                        }}
                      >
                        {summary.category}
                      </span>
                      {summary.description}
                    </div>
                    <div>
                      <span
                        style={{
                          backgroundColor: statusColors[summary.status],
                          color: 'white',
                          padding: '2px 6px',
                          borderRadius: '4px',
                          fontSize: '0.8em',
                        }}
                      >
                        {summary.status}
                      </span>
                    </div>
                    <div>
                      {getUserName(summary.lastBy)}
                      <br />
                      <span style={{ fontSize: '0.8em', color: '#555' }}>
                        {new Date(summary.latestTime).toLocaleString()}
                      </span>
                    </div>
                  </div>
                ))}
              </div>
              {/* Threaded entries */}
              {entries.map((entry) => (
                <EntryComponent key={entry.id} entry={entry} depth={0} />
              ))}
            </div>
          ) : (
            <div style={{ marginTop: '16px' }}>
              <h2>All Updates</h2>
              {summaries.map((summary) => (
                <div
                  key={summary.id}
                  style={{
                    border: '1px solid #ddd',
                    padding: '8px',
                    marginTop: '8px',
                    cursor: 'pointer',
                  }}
                  onClick={() => {
                    setView('threads');
                    setScrollToEntryId(summary.id);
                  }}
                >
                  <div>
                    <span
                      style={{
                        backgroundColor: categoryColors[summary.category],
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginRight: '4px',
                        fontSize: '0.8em',
                      }}
                    >
                      {summary.category}
                    </span>
                    {summary.description}
                  </div>
                  <div style={{ marginTop: '4px' }}>
                    <span
                      style={{
                        backgroundColor: statusColors[summary.status],
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.8em',
                      }}
                    >
                      {summary.status}
                    </span>{' '}
                    — {getUserName(summary.lastBy)} —{' '}
                    {new Date(summary.latestTime).toLocaleString()}
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      ) : (
        <div>
          <h2>Login</h2>
          <div style={{ display: 'flex', flexDirection: 'column', maxWidth: '300px', gap: '8px' }}>
            <input
              value={loginInitials}
              onChange={(e) => setLoginInitials(e.target.value)}
              placeholder="Initials"
            />
            <input
              value={loginName}
              onChange={(e) => setLoginName(e.target.value)}
              placeholder="Full name (if new user)"
            />
            <button onClick={handleLogin}>Log in</button>
          </div>
          {users.length > 0 && (
            <div style={{ marginTop: '12px' }}>
              <strong>Existing users:</strong>{' '}
              {users.map((u) => `${u.initials} (${u.name})`).join(', ')}
            </div>
          )}
        </div>
      )}
    </div>
  );
}