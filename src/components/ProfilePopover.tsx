/**
 * ProfilePopover — the little card that pops up under the top-bar avatar.
 *
 * Shows the user's picture, name, email and plan, with an "Edit profile"
 * modal for changing the picture (resized to a small data URL client-side)
 * and the username. Changes persist via Better Auth's update-user route,
 * so the new name/image is visible to other users (study rooms, quizzes…).
 */

import { useEffect, useRef, useState } from 'react';
import { updateProfile } from '../api/auth';
import type { AuthUser } from '../api/auth';
import { IconLogout } from './icons';

interface Props {
  user: AuthUser;
  tierLabel: string;
  onClose: () => void;
  onSignOut: () => void;
  /** Called after a successful save with the fresh user record. */
  onSaved: (user: AuthUser) => void;
  addToast: (msg: string, type?: 'success' | 'error' | 'info') => void;
}

/** Max edge of the stored avatar — keeps the data URL tiny (< ~40 KB). */
const AVATAR_MAX = 256;

/**
 * Read an image file and downscale it to a square-ish JPEG data URL.
 * Center-crops to a square so faces stay centered, then resizes.
 */
function fileToAvatarDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    if (!file.type.startsWith('image/')) {
      reject(new Error('Please pick an image file.'));
      return;
    }
    const reader = new FileReader();
    reader.onerror = () => reject(new Error('Could not read that file.'));
    reader.onload = () => {
      const img = new Image();
      img.onerror = () => reject(new Error('That file is not a readable image.'));
      img.onload = () => {
        const side = Math.min(img.naturalWidth, img.naturalHeight);
        const sx = (img.naturalWidth - side) / 2;
        const sy = (img.naturalHeight - side) / 2;
        const canvas = document.createElement('canvas');
        canvas.width = AVATAR_MAX;
        canvas.height = AVATAR_MAX;
        const ctx = canvas.getContext('2d');
        if (!ctx) { reject(new Error('Canvas is not supported here.')); return; }
        ctx.drawImage(img, sx, sy, side, side, 0, 0, AVATAR_MAX, AVATAR_MAX);
        resolve(canvas.toDataURL('image/jpeg', 0.82));
      };
      img.src = reader.result as string;
    };
    reader.readAsDataURL(file);
  });
}

function initialsOf(name: string, email: string): string {
  const base = (name || '').trim();
  if (base) {
    const parts = base.split(/\s+/).slice(0, 2);
    return parts.map(p => p.charAt(0).toUpperCase()).join('');
  }
  return (email || 'A').trim().charAt(0).toUpperCase();
}

export function ProfileAvatar({
  name, email, image, size = 32, className = '',
}: {
  name: string; email: string; image?: string | null; size?: number; className?: string;
}) {
  const initials = initialsOf(name, email);
  if (image) {
    return (
      <img
        src={image}
        alt={initials}
        className={className}
        style={{ width: size, height: size, borderRadius: '50%', objectFit: 'cover', display: 'block' }}
      />
    );
  }
  return (
    <span
      className={className}
      style={{
        width: size, height: size, borderRadius: '50%',
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        fontSize: size * 0.42, fontWeight: 700,
      }}
    >
      {initials}
    </span>
  );
}

export default function ProfilePopover({
  user, tierLabel, onClose, onSignOut, onSaved, addToast,
}: Props) {
  const [editing, setEditing] = useState(false);
  const [name, setName] = useState(user.name || '');
  const [image, setImage] = useState<string | null>(user.image ?? null);
  const [dirtyImage, setDirtyImage] = useState(false);
  const [saving, setSaving] = useState(false);
  const cardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  // Close on outside click / Escape (when not editing — the modal has its own overlay).
  useEffect(() => {
    if (editing) return;
    const onDown = (e: MouseEvent) => {
      if (cardRef.current && !cardRef.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [editing, onClose]);

  const pickPicture = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    try {
      const dataUrl = await fileToAvatarDataUrl(file);
      setImage(dataUrl);
      setDirtyImage(true);
    } catch (err: any) {
      addToast(err?.message || 'Could not load that image.', 'error');
    }
  };

  const save = async () => {
    const trimmed = name.trim();
    if (!trimmed) { addToast('Your name cannot be empty.', 'error'); return; }
    setSaving(true);
    try {
      const updated = await updateProfile(
        trimmed,
        dirtyImage ? image : undefined,
      );
      onSaved(updated);
      setEditing(false);
      addToast('Profile updated — it now shows for everyone.', 'success');
    } catch (err: any) {
      addToast(err?.message || 'Could not save your profile.', 'error');
    } finally {
      setSaving(false);
    }
  };

  const removePicture = () => {
    setImage(null);
    setDirtyImage(true);
  };

  return (
    <>
      <div ref={cardRef} className="sw-profile-pop" role="dialog" aria-label="Your profile">
        <div className="sw-profile-pop-head">
          <ProfileAvatar
            name={user.name || ''} email={user.email} image={user.image}
            size={44} className="sw-profile-pop-avatar"
          />
          <div className="sw-profile-pop-id">
            <div className="sw-profile-pop-name">{user.name || 'Student'}</div>
            <div className="sw-profile-pop-email">{user.email}</div>
          </div>
        </div>
        <div className="sw-profile-pop-meta">
          <span className="tag success">{tierLabel}</span>
          {user.emailVerified && <span className="tag">✓ verified</span>}
        </div>
        <div className="sw-profile-pop-actions">
          <button className="btn btn-secondary" onClick={() => setEditing(true)}>✏️ Edit profile</button>
          <button className="btn btn-secondary" onClick={onSignOut}>
            <IconLogout size={14} /> Sign out
          </button>
        </div>
      </div>

      {editing && (
        <div className="sw-profile-modal-scrim" onClick={() => !saving && setEditing(false)}>
          <div
            className="sw-profile-modal"
            role="dialog"
            aria-modal="true"
            aria-label="Edit profile"
            onClick={e => e.stopPropagation()}
          >
            <h3>Edit profile</h3>

            <div className="sw-profile-edit-row">
              <div className="sw-profile-edit-avatar-wrap">
                <ProfileAvatar
                  name={name} email={user.email} image={image}
                  size={72} className="sw-profile-edit-avatar"
                />
                <button
                  type="button"
                  className="sw-profile-edit-cam"
                  title="Change picture"
                  onClick={() => fileRef.current?.click()}
                >📷</button>
              </div>
              <div className="sw-profile-edit-btns">
                <button className="btn btn-secondary btn-sm" onClick={() => fileRef.current?.click()}>
                  Upload picture
                </button>
                {image && (
                  <button className="btn btn-ghost btn-sm" onClick={removePicture}>
                    Remove picture
                  </button>
                )}
                <input
                  ref={fileRef}
                  type="file"
                  accept="image/*"
                  onChange={pickPicture}
                  style={{ display: 'none' }}
                />
              </div>
            </div>

            <label className="sw-profile-field">
              <span>Username (visible to others)</span>
              <input
                type="text"
                value={name}
                maxLength={40}
                onChange={e => setName(e.target.value)}
                placeholder="Your name"
                autoFocus
              />
            </label>

            <div className="sw-profile-modal-actions">
              <button className="btn btn-ghost" disabled={saving} onClick={() => setEditing(false)}>Cancel</button>
              <button className="btn btn-primary" disabled={saving || !name.trim()} onClick={save}>
                {saving ? 'Saving…' : 'Save changes'}
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
