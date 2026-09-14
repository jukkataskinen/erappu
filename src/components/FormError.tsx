import { Notice } from "./ui";

export function FormError({ message }: { message?: string | string[] }) {
  const text = Array.isArray(message) ? message[0] : message;
  if (!text) return null;
  return (
    <div className="mb-5" role="alert">
      <Notice tone="alert" title="Tallennus ei onnistunut">
        {text}
      </Notice>
    </div>
  );
}
