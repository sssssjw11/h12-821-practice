import { useState } from "react";
import { Button, Modal } from "./components";
import { api, type User } from "./sync";

export function AccountDialog({
  user,
  onUser,
  onClose,
}: {
  user: User | null;
  onUser: (user: User | null) => void;
  onClose: () => void;
}) {
  const [register, setRegister] = useState(false);
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const submit = async () => {
    setBusy(true);
    setError("");
    try {
      if (user) {
        await api("/api/auth/logout", {});
        onUser(null);
      } else {
        const result = await api(
          `/api/auth/${register ? "register" : "login"}`,
          { username, password },
        );
        onUser(result.user);
      }
      onClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : "请求失败，请重试。");
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      title={user ? "同步账号" : register ? "注册同步账号" : "登录同步账号"}
      onClose={() => {
        if (!busy) onClose();
      }}
    >
      {user ? (
        <>
          <p>
            当前账号：<strong>{user.username}</strong>
          </p>
          <p>
            在另一台设备打开同一服务器地址，登录同一账号即可续做。退出后，本设备未同步的修改仍保留在此账号的浏览器缓存中，下次登录可继续同步。
          </p>
          {error && <p role="alert">{error}</p>}
          <div className="modal-actions">
            <Button onClick={onClose} disabled={busy}>
              继续学习
            </Button>
            <Button onClick={() => void submit()} disabled={busy}>
              {busy ? "正在退出…" : "退出账号"}
            </Button>
          </div>
        </>
      ) : (
        <form
          className="account-form"
          onSubmit={(e) => {
            e.preventDefault();
            void submit();
          }}
        >
          <p>
            使用同一账号同步章节位置、作答、错题和收藏。未登录的旧进度可在登录后手动迁移。
          </p>
          <label htmlFor="account-name">用户名</label>
          <input
            id="account-name"
            name="username"
            autoComplete="username"
            required
            minLength={3}
            maxLength={32}
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            disabled={busy}
            placeholder="3–32 位文字、数字、下划线"
          />
          <label htmlFor="account-password">密码</label>
          <input
            id="account-password"
            name="password"
            type="password"
            autoComplete={register ? "new-password" : "current-password"}
            required
            minLength={8}
            maxLength={128}
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            disabled={busy}
            placeholder="至少 8 位"
          />
          {error && (
            <p className="account-error" role="alert">
              {error}
            </p>
          )}
          <div className="modal-actions">
            <Button
              variant="ghost"
              disabled={busy}
              onClick={() => {
                setRegister(!register);
                setError("");
              }}
            >
              {register ? "已有账号，去登录" : "没有账号，去注册"}
            </Button>
            <Button type="submit" variant="primary" disabled={busy}>
              {busy ? "正在连接…" : register ? "注册并登录" : "登录"}
            </Button>
          </div>
        </form>
      )}
    </Modal>
  );
}
