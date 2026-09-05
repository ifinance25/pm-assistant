import { Link } from "react-router-dom";

export function AuthStubPage({ title, body }: { title: string; body: string }) {
  return (
    <div style={{ padding: 32, maxWidth: 480, margin: "0 auto" }}>
      <h1>{title}</h1>
      <p>{body}</p>
      <p>
        <Link to="/login">Вернуться ко входу</Link>
      </p>
    </div>
  );
}
