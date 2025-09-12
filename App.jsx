import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'speedforce_update_thread_app';

function App() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
  const [status, setStatus] = useState('New');
  const [view, setView] = useState('threads');

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
          .map((col) => '<td>' + escapeHtml(col) + '</td>')
          .join('');
        return '<tr>' + cells + '</tr>';
      })
      .join('');
    return '<table>' + tableRows + '</table>';
  }

  const handlePaste = (e) => {
    const clipboardData = e.clipboardData;
    const plain = clipboardData.getData('text/plain');
    if (plain && /\t/.test(plain)) {
      e.preventDefault();
      const tableHtml = tsvToHtml(plain);
      setHtml((prev) => prev + tableHtml);
    }
  };

  function addUser(name, initials) {
    if (!initials) return;
    if (users.some((u) => u.initials === initials)) return;
    setUsers((prev) => [...prev, { name, initials }]);
    setSelectedUser(initials);
  }

  function addEntry(parentId = null, entryHtml = html, entryTitle = title, entryStatus = status) {
    if (!selectedUser || !entryHtml.trim()) return;
    const newEntry = {
      id: Date.now().toString(),
      parentId,
      initials: selectedUser,
      title: entryTitle || '(untitled)',
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
    setTitle('');
    setStatus('New');
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
    const [editTitle, setEditTitle] = useState(entry.title);
    const [editHtml, setEditHtml] = useState(entry.html);
    const [editStatus, setEditStatus] = useState(entry.status);
    const [replying, setReplying] = useState(false);
    const [replyHtml, setReplyHtml] = useState('');

    function handleEditSave() {
      updateEntry(entry.id, { title: editTitle, html: editHtml, status: editStatus });
      setEditing(false);
    }

    function handleReplySave() {
      addEntry(entry.id, replyHtml, entry.title, entry.status);
      setReplying(false);
      setReplyHtml('');
    }

    return (
      <div style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px', marginLeft: depth ? depth * 20 + 'px' : '0' }}>
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ fontWeight: 'bold' }}>{entry.title}</div>
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
            <input
              value={editTitle}
              onChange={(e) => setEditTitle(e.target.value)}
              placeholder="Title"
              style={{ width: '100%', marginBottom: '4px' }}
            />
            <select value={editStatus} onChange={(e) => setEditStatus(e.target.value)} style={{ marginBottom: '4px' }}>
              {['New', 'In Progress', 'Complete', 'Cancelled'].map((opt) => (
                <option key={opt} value={opt}>
                  {opt}
                </option>
              ))}
            </select>
            <textarea
              value={editHtml}
              onChange={(e) => setEditHtml(e.target.value)}
              style={{ width: '100%', height: '80px' }}
            />
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
              <textarea
                value={replyHtml}
                onChange={(e) => setReplyHtml(e.target.value)}
                style={{ width: '100%', height: '60px' }}
              />
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
      <h1>Speedforce Updates</h1>
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
        <input
          placeholder="Title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', marginTop: '8px' }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ marginTop: '4px' }}>
          {['New', 'In Progress', 'Complete', 'Cancelled'].map((opt) => (
            <option key={opt} value={opt}>
              {opt}
            </option>
          ))}
        </select>
        <textarea
          value={html}
          onChange={(e) => setHtml(e.target.value)}
          onPaste={handlePaste}
          style={{ width: '100%', height: '100px', marginTop: '4px' }}
          placeholder="Enter your message. Paste Excel/TSV tables here."
        />
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
                  <span style={{ fontWeight: 'bold' }}>{entry.title}</span>
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
