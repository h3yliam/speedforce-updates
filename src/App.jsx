import React, { useState, useEffect } from 'react';

const STORAGE_KEY = 'speedforce_update_thread_app';

function App() {
  const [entries, setEntries] = useState([]);
  const [users, setUsers] = useState([]);
  const [selectedUser, setSelectedUser] = useState('');
  const [title, setTitle] = useState('');
  const [html, setHtml] = useState('');
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

  function addEntry(parentId = null, entryHtml = html, entryTitle = title) {
    if (!selectedUser || !entryHtml.trim()) return;
    const newEntry = {
      id: Date.now().toString(),
      parentId,
      initials: selectedUser,
      title: entryTitle || '(untitled)',
      html: entryHtml,
      createdAt: new Date().toISOString(),
      editedAt: null,
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
  }

  function updateEntry(id, fields) {
    setEntries((prev) => {
      const update = (list) =>
        list.map((item) => {
          if (item.id === id) {
            return { ...item, ...fields, editedAt: new Date().toISOString() };
          }
          return { ...item, children: update(item.children) };
        });
      return update(prev);
    });
  }

  function getLatest(entry) {
    let latest = entry.editedAt || entry.createdAt;
    entry.children.forEach((child) => {
      const childLatest = getLatest(child);
      if (childLatest > latest) latest = childLatest;
    });
    return latest;
  }

  const sortedEntries = [...entries].sort((a, b) => {
    const al = getLatest(a);
    const bl = getLatest(b);
    return bl.localeCompare(al);
  });

  function Entry({ entry, depth = 0 }) {
    const [editing, setEditing] = useState(false);
    const [editTitle, setEditTitle] = useState(entry.title);
    const [editHtml, setEditHtml] = useState(entry.html);
    const [replying, setReplying] = useState(false);
    const [replyHtml, setReplyHtml] = useState('');

    function handleEditSave() {
      updateEntry(entry.id, { title: editTitle, html: editHtml });
      setEditing(false);
    }

    function handleReplySave() {
      addEntry(entry.id, replyHtml, entry.title);
      setReplying(false);
      setReplyHtml('');
    }

    return (
      <div style={{ border: '1px solid #ddd', padding: '8px', marginTop: '8px', marginLeft: depth ? depth * 20 + 'px' : '0' }}>
        <div style={{ fontWeight: 'bold' }}>{entry.title}</div>
        <div style={{ fontSize: '0.8em', color: '#666' }}>
          {entry.initials} - {new Date(entry.createdAt).toLocaleString()}
        </div>
        {entry.editedAt && (
          <div style={{ fontSize: '0.7em', color: '#666' }}>edited {new Date(entry.editedAt).toLocaleString()}</div>
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
          {sortedEntries.map((entry) => (
            <Entry key={entry.id} entry={entry} />
          ))}
        </div>
      )}
    </div>
  );
}

export default App;
