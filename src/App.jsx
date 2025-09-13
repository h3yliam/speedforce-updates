import React, { useState, useEffect, useRef } from 'react';

// Local storage key for persisting entries and users across sessions
const STORAGE_KEY = 'speedforce_update_thread_app';

function App() {
  // Entries hold the list of top-level threads and their nested replies
  const [entries, setEntries] = useState([]);
  // Users and the currently selected user initials
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  // Form fields for new updates
  const [category, setCategory] = useState('RFQ');
  const [description, setDescription] = useState('');
  const [status, setStatus] = useState('New');
  const [html, setHtml] = useState('');
  // Which view to show: 'threads' for the threaded view, 'all' for the summary
  const [view, setView] = useState('threads');
  // If set, the threads view will scroll the entry with this id into view
  const [scrollToEntryId, setScrollToEntryId] = useState(null);
  // Ref to the message input div for new updates
  const messageRef = useRef(null);

  // On mount, load saved entries and users from localStorage
  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    setEntries(saved.entries || []);
    setUsers(saved.users || []);
  }, []);

  // Persist entries and users to localStorage whenever they change
  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, users }));
  }, [entries, users]);

  // If we switch to the threads view and have a pending scroll target, scroll into view
  useEffect(() => {
    if (view === 'threads' && scrollToEntryId) {
      const el = document.getElementById(`entry-${scrollToEntryId}`);
      if (el) {
        el.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
      setScrollToEntryId(null);
    }
  }, [view, scrollToEntryId]);

  // Escape HTML to prevent injection when converting plain text to HTML
  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // Convert tab-separated text into an HTML table
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

  // Handle paste events on the main message input. Supports pasting HTML tables and TSV
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
      } catch (_) {
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
        setHtml(messageRef.current.innerHTML);
      } else {
        setHtml((prev) => prev + tableHtml);
      }
      return;
    }
    const plain = clipboardData.getData('text/plain');
    if (plain && /\t/.test(plain)) {
      e.preventDefault();
      const tableHtml = tsvToHtml(plain);
      if (messageRef.current) {
        document.execCommand('insertHTML', false, tableHtml);
        setHtml(messageRef.current.innerHTML);
      } else {
        setHtml((prev) => prev + tableHtml);
      }
    }
  };

  // Add a new user to the dropdown
  function addUser(name, initials) {
    if (!initials) return;
    if (users.some((u) => u.initials === initials)) return;
    setUsers((prev) => [...prev, { name, initials }]);
    setSelectedUser(initials);
  }

  // Add a new entry or reply. Replies inherit the parent entry's category, description and status
  function addEntry(
    parentId = null,
    entryHtml = html,
    entryCategory = category,
    entryDescription = description,
    entryStatus = status
  ) {
    let initials = selectedUser;
    if (!initials && parentId) {
      const findById = (list, id) => {
        for (const item of list) {
          if (item.id === id) return item;
          const found = findById(item.children, id);
          if (found) return found;
        }
        return null;
      };
      const parentEntry = findById(entries, parentId);
      if (parentEntry) {
        initials = parentEntry.initials;
      }
    }
    if (!initials || !entryHtml.trim()) return;
    const newEntry = {
      id: Date.now().toString(),
      parentId,
      initials,
      category: entryCategory,
      description: entryDescription,
      html: entryHtml,
      status: entryStatus,
      createdAt: new Date().toISOString(),
      editedAt: null,
      editedBy: null,
      children: [],
    };
    setEntries((prev) => {
      if (!parentId) {
        return [...prev, newEntry];
      }
      const addToParent = (list) =>
        list.map((item) => {
          if (item.id === parentId) {
            return { ...item, children: [...item.children, newEntry] };
          }
          return { ...item, children: addToParent(item.children) };
        });
      return addToParent(prev);
    });
    setHtml('');
    setCategory('RFQ');
    setDescription('');
    setStatus('New');
    if (messageRef.current) {
      messageRef.current.innerHTML = '';
    }
  }

  // Update an existing entry with new fields (html and/or status)
  function updateEntry(id, fields) {
    setEntries((prev) => {
      const update = (list) =>
        list.map((item) => {
          if (item.id === id) {
            return { ...item, ...fields, editedAt: new Date().toISOString(), editedBy: selectedUser };
          }
          return { ...item, children: update(item.children) };
        });
      return update(prev);
    });
  }

  // Find the latest update timestamp and user for a thread
  function getLastInfo(entry) {
    let latest = entry.editedAt || entry.createdAt;
    let lastBy = entry.editedAt ? (entry.editedBy || entry.initials) : entry.initials;
    entry.children.forEach((child) => {
      const info = getLastInfo(child);
      if (info.latest > latest) {
        latest = info.latest;
        lastBy = info.lastBy;
      }
    });
    return { latest, lastBy };
  }

  // Find the latest update details (timestamp, user and html) for a thread
  function getLastDetails(entry) {
    let latestTime = entry.editedAt || entry.createdAt;
    let lastBy = entry.editedAt ? (entry.editedBy || entry.initials) : entry.initials;
    let lastHtml = entry.html;
    entry.children.forEach((child) => {
      const info = getLastDetails(child);
      if (new Date(info.latestTime) > new Date(latestTime)) {
        latestTime = info.latestTime;
        lastBy = info.lastBy;
        lastHtml = info.lastHtml;
      }
    });
    return { latestTime, lastBy, lastHtml };
  }

  // Navigate back to threads view and scroll to a specific entry id
  function goToThread(id) {
    setView('threads');
    setScrollToEntryId(id);
  }

  // Sort threads by their latest activity
  const sortedEntries = [...entries].sort((a, b) => {
    const al = getLastInfo(a).latest;
    const bl = getLastInfo(b).latest;
    return bl.localeCompare(al);
  });

  // Component to render a single entry and its replies
  function Entry({ entry, depth = 0 }) {
    const [editing, setEditing] = useState(false);
    const [editHtml, setEditHtml] = useState(entry.html);
    const [editStatus, setEditStatus] = useState(entry.status);
    const [replying, setReplying] = useState(false);
    const [replyHtml, setReplyHtml] = useState('');
    // For top-level entries, collapsed by default; nested entries always expanded
    const [showHistory, setShowHistory] = useState(depth !== 0);
    const editRef = useRef(null);
    const replyRef = useRef(null);

    // Handle paste for edit and reply contentEditable fields
    const handleGenericPaste = (e, ref, setValue) => {
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
        } catch (_) {
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
        if (ref.current) {
          document.execCommand('insertHTML', false, tableHtml);
          setValue(ref.current.innerHTML);
        } else {
          setValue((prev) => prev + tableHtml);
        }
        return;
      }
      const plain = clipboardData.getData('text/plain');
      if (plain && /\t/.test(plain)) {
        e.preventDefault();
        const tableHtml = tsvToHtml(plain);
        if (ref.current) {
          document.execCommand('insertHTML', false, tableHtml);
          setValue(ref.current.innerHTML);
        } else {
          setValue((prev) => prev + tableHtml);
        }
      }
    };

    // Save edits to an entry
    function handleEditSave() {
      const latestHtml = editRef.current ? editRef.current.innerHTML : editHtml;
      updateEntry(entry.id, { html: latestHtml, status: editStatus });
      setEditing(false);
    }

    // Save a reply to this entry
    function handleReplySave() {
      const latestReply = replyRef.current ? replyRef.current.innerHTML : replyHtml;
      addEntry(entry.id, latestReply, entry.category, entry.description, entry.status);
      setReplying(false);
      setReplyHtml('');
    }

    // Collapsed view for top-level entries shows only the latest update
    if (!showHistory && depth === 0) {
      const details = getLastDetails(entry);
      return (
        <div id={`entry-${entry.id}`} style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px', marginLeft: depth ? depth * 20 + 'px' : '0' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 'bold' }}>
              {entry.category}
              {entry.description ? ' - ' + entry.description : ''}
            </div>
            <div>
              <span style={{ borderRadius: '4px', padding: '2px 6px', border: '1px solid #ccc', fontSize: '0.75em' }}>{entry.status}</span>
            </div>
          </div>
          <div style={{ fontSize: '0.8em', color: '#666' }}>
            {details.lastBy} - {new Date(details.latestTime).toLocaleString()}
          </div>
          <div dangerouslySetInnerHTML={{ __html: details.lastHtml }} />
          <button onClick={() => setShowHistory(true)} style={{ marginTop: '4px' }}>
            Show past updates
          </button>
        </div>
      );
    }

    // Expanded view shows the full entry and its history
    return (
      <div id={`entry-${entry.id}`} style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px', marginLeft: depth ? depth * 20 + 'px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 'bold' }}>
            {entry.category}
            {entry.description ? ' - ' + entry.description : ''}
          </div>
          <div>
            <span style={{ borderRadius: '4px', padding: '2px 6px', border: '1px solid #ccc', marginLeft: '8px', fontSize: '0.75em' }}>{entry.status}</span>
            {depth === 0 && (
              <button onClick={() => setShowHistory(false)} style={{ marginLeft: '8px' }}>
                Hide past updates
              </button>
            )}
          </div>
        </div>
        <div style={{ fontSize: '0.8em', color: '#666' }}>
          {entry.initials} - {new Date(entry.createdAt).toLocaleString()}
        </div>
        {entry.editedAt && (
          <div style={{ fontSize: '0.7em', color: '#666' }}>
            edited {new Date(entry.editedAt).toLocaleString()} by {entry.editedBy || entry.initials}
          </div>
        )}
        {!editing ? (
          <div dangerouslySetInnerHTML={{ __html: entry.html }} />
        ) : (
          <div>
            <div style={{ fontWeight: 'bold', marginBottom: '4px' }}>
              {entry.category}
              {entry.description ? ' - ' + entry.description : ''}
            </div>
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ marginBottom: '4px' }}>
              {['New', 'In Progress', 'Complete', 'Cancelled'].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <div
              ref={editRef}
              contentEditable
              onPaste={(e) => handleGenericPaste(e, editRef, setEditHtml)}
              onInput={() => {
                if (editRef.current) {
                  setEditHtml(editRef.current.innerHTML);
                }
              }}
              dangerouslySetInnerHTML={{ __html: editHtml }}
              style={{
                width: '100%',
                height: '80px',
                padding: '4px',
                border: '1px solid #ccc',
                overflowY: 'auto',
                whiteSpace: 'pre-wrap',
              }}
            ></div>
          </div>
        )}
        <div style={{ marginTop: '4px' }}>
          {!editing ? (
            <button onClick={() => setEditing(true)}>Edit</button>
          ) : (
            <button onClick={handleEditSave}>Save</button>
          )}
          {!replying ? (
            <button onClick={() => setReplying(true)} style={{ marginLeft: '4px' }}>
              Reply
            </button>
          ) : (
            <span style={{ display: 'block', marginTop: '4px' }}>
              <div
                ref={replyRef}
                contentEditable
                onPaste={(e) => handleGenericPaste(e, replyRef, setReplyHtml)}
                onInput={() => {
                  if (replyRef.current) {
                    setReplyHtml(replyRef.current.innerHTML);
                  }
                }}
                style={{
                  width: '100%',
                  height: '60px',
                  padding: '4px',
                  border: '1px solid #ccc',
                  overflowY: 'auto',
                  whiteSpace: 'pre-wrap',
                }}
              ></div>
              <button onClick={handleReplySave}>Save Reply</button>
            </span>
          )}
        </div>
        {entry.children &&
          entry.children.map((child) => (
            <Entry key={child.id} entry={child} depth={depth + 1} />
          ))}
      </div>
    );
  }

  return (
    <div style={{ padding: '16px', fontFamily: 'sans-serif' }}>
      <h1>Daily Mail</h1>
      <div style={{ marginBottom: '16px' }}>
        <div>
          <label>User: </label>
          <select value={selectedUser} onChange={(e) => setSelectedUser(e.target.value)}>
            <option value="">Select initials</option>
            {users.map((u) => (
              <option key={u.initials} value={u.initials}>
                {u.initials}
              </option>
            ))}
          </select>
          <input placeholder="New user name" id="newUserName" style={{ marginLeft: '8px' }} />
          <input placeholder="Initials" id="newUserInitials" style={{ marginLeft: '4px', width: '60px' }} />
          <button
            onClick={() => {
              const name = document.getElementById('newUserName').value;
              const initials = document.getElementById('newUserInitials').value;
              addUser(name, initials);
              document.getElementById('newUserName').value = '';
              document.getElementById('newUserInitials').value = '';
            }}
            style={{ marginLeft: '4px' }}
          >
            Add User
          </button>
        </div>
        <div style={{ marginTop: '8px' }}>
          <label style={{ marginRight: '4px' }}>Category:</label>
          <select value={category} onChange={(e) => setCategory(e.target.value)}>
            {['RFQ', 'PO', 'ETA', 'CLAIM'].map((opt) => (
              <option key={opt} value={opt}>
                {opt}
              </option>
            ))}
          </select>
        </div>
        <input
          placeholder="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          style={{ width: '100%', marginTop: '4px' }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginTop: '4px' }}>
          {['New', 'In Progress', 'Complete', 'Cancelled'].map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <div
          ref={messageRef}
          contentEditable
          onPaste={handlePaste}
          onInput={() => {
            if (messageRef.current) {
              setHtml(messageRef.current.innerHTML);
            }
          }}
          style={{
            width: '100%',
            height: '100px',
            marginTop: '4px',
            padding: '4px',
            border: '1px solid #ccc',
            overflowY: 'auto',
            whiteSpace: 'pre-wrap',
          }}
          data-placeholder="Enter your message. Paste Excel/TSV tables here."
        ></div>
        <button onClick={() => addEntry()} style={{ marginTop: '4px' }}>
          Save
        </button>
      </div>
      <div>
        <button onClick={() => setView('threads')}>Threads</button>
        <button onClick={() => setView('all')} style={{ marginLeft: '4px' }}>
          All Updates
        </button>
      </div>
      {view === 'threads' ? (
        <div>
          {/* Overview table showing each thread and its latest update */}
          <div
            style={{
              marginTop: '16px',
              border: '1px solid #ddd',
              borderRadius: '4px',
              overflow: 'hidden',
            }}
          >
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: '3fr 1fr 2fr',
                fontWeight: 'bold',
                backgroundColor: '#f4f4f4',
                borderBottom: '1px solid #ddd',
                padding: '8px 4px',
              }}
            >
              <div>Title</div>
              <div>Status</div>
              <div>Last update</div>
            </div>
            {sortedEntries.map((entry) => {
              const details = getLastDetails(entry);
              const entryUser = getUserName(details.lastBy);
              return (
                <div
                  key={'overview-' + entry.id}
                  onClick={() => goToThread(entry.id)}
                  style={{
                    display: 'grid',
                    gridTemplateColumns: '3fr 1fr 2fr',
                    padding: '6px 4px',
                    alignItems: 'center',
                    cursor: 'pointer',
                    borderBottom: '1px solid #f0f0f0',
                    fontSize: '0.9em',
                  }}
                >
                  <div>
                    <span
                      style={{
                        backgroundColor: categoryColors[entry.category] || '#ccc',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        marginRight: '4px',
                        fontSize: '0.75em',
                      }}
                    >
                      {entry.category}
                    </span>
                    {entry.description ? entry.description : '(untitled)'}
                  </div>
                  <div>
                    <span
                      style={{
                        backgroundColor: statusColors[entry.status] || '#ccc',
                        color: 'white',
                        padding: '2px 6px',
                        borderRadius: '4px',
                        fontSize: '0.75em',
                      }}
                    >
                      {entry.status}
                    </span>
                  </div>
                  <div style={{ fontSize: '0.8em', color: '#555' }}>
                    {new Date(details.latestTime).toLocaleString()} by {entryUser}
                  </div>
                </div>
              );
            })}
          </div>
          {/* Threads list */}
          <div style={{ marginTop: '16px' }}>
            {entries.map((entry) => (
              <Entry key={entry.id} entry={entry} />
            ))}
          </div>
        </div>
      ) : (
        <div>
          {/* Summary list for all threads. Each card shows the latest update's content, timestamp, and author. Clicking navigates to the thread. */}
          {sortedEntries.map((entry) => {
            const details = getLastDetails(entry);
            return (
              <div
                key={entry.id}
                onClick={() => goToThread(entry.id)}
                style={{
                  border: '1px solid #ddd',
                  padding: '8px',
                  marginTop: '8px',
                  cursor: 'pointer',
                  backgroundColor: '#f9f9f9',
                }}
              >
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>
                    {entry.category}
                    {entry.description ? ' - ' + entry.description : ''}
                  </span>
                  <span
                    style={{
                      borderRadius: '4px',
                      padding: '2px 6px',
                      border: '1px solid #ccc',
                      fontSize: '0.75em',
                    }}
                  >
                    {entry.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.8em', color: '#666', marginTop: '2px' }}>
                  Latest: {new Date(details.latestTime).toLocaleString()} by {details.lastBy}
                </div>
                {/* Show a small preview of the latest update content. Use dangerouslySetInnerHTML to render HTML tables. */}
                <div
                  dangerouslySetInnerHTML={{ __html: details.lastHtml }}
                  style={{
                    marginTop: '4px',
                    fontSize: '0.85em',
                    maxHeight: '120px',
                    overflow: 'hidden',
                    borderTop: '1px solid #eee',
                    paddingTop: '4px',
                  }}
                ></div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;