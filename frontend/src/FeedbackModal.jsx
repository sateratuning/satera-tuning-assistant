import React, { useState } from 'react';

export default function FeedbackModal({ open, onClose, onSubmit, defaultPage }) {
  const [email, setEmail] = useState('');
  const [message, setMessage] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [done, setDone] = useState(false);

  if (!open) return null;

  const pagePath = defaultPage || window.location.pathname;

  const submit = async (e) => {
    e?.preventDefault?.();
    if (!message || message.trim().length < 5) {
      alert('Please include a short description.');
      return;
    }
    setSubmitting(true);
    try {
      const ok = await onSubmit?.({ email, page: pagePath, message });
      if (ok) setDone(true);
      else alert('Failed to send. Please try again.');
    } catch (err) {
      console.error(err);
      alert('Failed to send. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div
      style={{
        position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)',
        display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 9999
      }}
      onClick={onClose}
    >
      <div
        style={{
          width: '95%', maxWidth: 520, background: '#0f130f', color: '#d9ffe0',
          border: '1px solid #1e2b1e', borderRadius: 12, padding: 18,
          boxShadow: '0 10px 30px rgba(0,0,0,0.5)'
        }}
        onClick={(e) => e.stopPropagation()}
      >
        {!done ? (
          <>
            <h2 style={{ margin: '4px 0 12px' }}>Report an issue</h2>
            <p style={{ opacity: .9, marginTop: 0 }}>
              Spotted a bug or need help? Tell us what happened.
            </p>

            <form onSubmit={submit}>
              <label style={{ display: 'block', fontSize: 14, opacity: .9, marginTop: 8 }}>
                Your email (optional)
              </label>
              <input
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="you@example.com"
                style={{
                  width: '100%', background: '#0b120b', border: '1px solid #1e2b1e',
                  borderRadius: 8, padding: '10px 12px', color: '#d9ffe0'
                }}
              />

              <label style={{ display: 'block', fontSize: 14, opacity: .9, marginTop: 12 }}>
                What went wrong?
              </label>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                rows={6}
                placeholder="What were you doing? What did you expect vs see?"
                style={{
                  width: '100%', background: '#0b120b', border: '1px solid #1e2b1e',
                  borderRadius: 8, padding: '10px 12px', color: '#d9ffe0'
                }}
              />

              <div style={{ display: 'flex', gap: 8, marginTop: 14, justifyContent: 'flex-end' }}>
                <button
                  type="button"
                  onClick={onClose}
                  style={{
                    background: 'transparent', border: '1px solid #2b3a2b',
                    color: '#d9ffe0', padding: '10px 14px', borderRadius: 10, cursor: 'pointer'
                  }}
                >
                  Cancel
                </button>
                <button
                  disabled={submitting}
                  type="submit"
                  style={{
                    background: '#1ea94d', border: 'none', color: '#06220f',
                    padding: '10px 14px', borderRadius: 10, fontWeight: 700,
                    cursor: 'pointer', opacity: submitting ? 0.7 : 1
                  }}
                >
                  {submitting ? 'Sending…' : 'Send'}
                </button>
              </div>
            </form>
          </>
        ) : (
          <>
            <h2 style={{ margin: '4px 0 12px' }}>Thanks!</h2>
            <p style={{ opacity: .9 }}>We received your message and will take a look.</p>
            <div style={{ textAlign: 'right', marginTop: 12 }}>
              <button
                onClick={onClose}
                style={{
                  background: '#1ea94d', border: 'none', color: '#06220f',
                  padding: '10px 14px', borderRadius: 10, fontWeight: 700, cursor: 'pointer'
                }}
              >
                Close
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
