import React, { useState, useEffect, useRef } from 'react';

const STORAGE_KEY = 'speedforce_update_thread_app';

function App() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  // Category selector (RFQ, PO, ETA, CLAIM) and description for each update
  const [category, setCategory] = useState('RFQ');
  const [description, setDescription] = useState('');
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState('New');
  const [view, setView] = useState('threads');
  // Ref for the contentEditable message input. Allows WYSIWYG table preview.
  const messageRef = useRef(null);

  useEffect(() => {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    setEntries(saved.entries || []);
    setUsers(saved.users || []);
  }, []);

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ entries, users }));
  }, [entries, users]);

  function escapeHtml(str) {
    return str.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

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
          .map((col) =>
            `<td style="border: 1px solid #ccc; padding: 4px;">${escapeHtml(col)}</td>`
          )
          .join('');
        return '<tr>' + cells + '</tr>';
      })
      .join('');
    // Add basic styling to mimic spreadsheet cell borders
    return `<table style="border-collapse: collapse;">${tableRows}</table>`;
  }

  const handlePaste = (e) => {
    const clipboardData = e.clipboardData;
    // Grab HTML and plain text from the clipboard. Excel and Google Sheets often put rich
    // HTML with <html>, <head>, and <body> tags on the clipboard.
    const htmlData = clipboardData.getData('text/html');
    // If HTML contains a table, parse and sanitize it
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
    // Otherwise, if tab-separated plain text exists, convert it to a table
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

  function addUser(name, initials) {
    if (!initials) return;
    if (users.some((u) => u.initials === initials)) return;
    setUsers((prev) => [...prev, { name, initials }]);
    setSelectedUser(initials);
  }

       function addEntry(
         parentId = null,
         entryHtml = html,
         entryCategory = category,
         entryDescription = description,
         entryStatus = status
       ) {
         // Determine which user's initials to apply to this entry. Use the
         // currently selected user if present. Otherwise, for replies,
         // inherit the initials from the parent entry so that a user can
         // quickly reply without manually re-selecting their initials.
         let initials = selectedUser;
         if (!initials && parentId) {
           // Search the entries tree for the parent entry to get its initials
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
         // Do not create an entry if we still have no initials or no content
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
         // Reset category and description after saving
         setCategory('RFQ');
         setDescription('');
         setStatus('New');
         // Clear content of the editable div so the user sees an empty message area
         if (messageRef.current) {
           messageRef.current.innerHTML = '';
         }
       }

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

  const sortedEntries = [...entries].sort((a, b) => {
    const al = getLastInfo(a).latest;
    const bl = getLastInfo(b).latest;
    return bl.localeCompare(al);
  });

  function Entry({ entry, depth = 0 }) {
    const [editing, setEditing] = useState(false);
    // Title editing is removed; entries have immutable category/description
    const [editHtml, setEditHtml] = useState(entry.html);
    const [editStatus, setEditStatus] = useState(entry.status);
    const [replying, setReplying] = useState(false);
    const [replyHtml, setReplyHtml] = useState('');
    // Refs for edit and reply inputs to support contentEditable with paste handling
    const editRef = useRef(null);
    const replyRef = useRef(null);
    // Generic paste handler for edit and reply inputs. It sanitizes HTML tables
    // copied from Excel and inserts them with visible borders, or converts
    // TSV data into an HTML table.
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

    function handleEditSave() {
      // Only update the HTML and status. Category/description remain unchanged.
      // Read the latest HTML from the editable div in case the state hasn't caught up yet
      const latestHtml = editRef.current ? editRef.current.innerHTML : editHtml;
      updateEntry(entry.id, { html: latestHtml, status: editStatus });
      setEditing(false);
    }

    function handleReplySave() {
      // Replies inherit the category, description and status of the parent entry
      // Grab latest HTML from the reply contentEditable to avoid stale state when saving
      const latestReply = replyRef.current ? replyRef.current.innerHTML : replyHtml;
      addEntry(entry.id, latestReply, entry.category, entry.description, entry.status);
      setReplying(false);
      setReplyHtml('');
    }

    return (
      <div style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px', marginLeft: depth ? depth * 20 + 'px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 'bold' }}>
            {entry.category}
            {entry.description ? ' - ' + entry.description : ''}
          </div>
          <div>
            <span style={{ borderRadius: '4px', padding: '2px 6px', border: '1px solid #ccc', marginLeft: '8px', fontSize: '0.75em' }}>{entry.status}</span>
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
            {/* Display category and description read-only while editing */}
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
        {/* Category dropdown and description replace the old title field */}
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
          {entries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </div>
      ) : (
        <div>
          {/* Summary list for all updates */}
          {sortedEntries.map((entry) => {
            const info = getLastInfo(entry);
            return (
              <div key={entry.id} style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span style={{ fontWeight: 'bold' }}>
                    {entry.category}
                    {entry.description ? ' - ' + entry.description : ''}
                  </span>
                  <span style={{ borderRadius: '4px', padding: '2px 6px', border: '1px solid #ccc', fontSize: '0.75em' }}>
                    {entry.status}
                  </span>
                </div>
                <div style={{ fontSize: '0.8em', color: '#666' }}>
                  Latest: {new Date(info.latest).toLocaleString()} by {info.lastBy}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

export default App;
