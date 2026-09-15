import { Input, Select, Textarea } from "@/components/ui";
import type { FieldDef, FieldValue } from "@/lib/contract-templates";

/** Kannan arvo lomakkeen kenttään: raha pilkulla, totuusarvo valintana. */
export function inputValue(field: FieldDef, value: FieldValue | undefined): string {
  if (value === null || value === undefined) return "";
  if (typeof value === "boolean") return value ? "true" : "false";
  if (field.type === "money") return value.replace(".", ",");
  return value;
}

/** Pohjan kenttämäärittelystä muodostuva syöte. */
export function FieldInput({
  field,
  name,
  id,
  value,
  providers,
  placeholder,
  invalid,
  disabled,
  compact,
}: {
  field: FieldDef;
  name: string;
  id: string;
  value: FieldValue | undefined;
  providers?: { id: string; name: string }[];
  placeholder?: string;
  invalid?: boolean;
  disabled?: boolean;
  compact?: boolean;
}) {
  const cls = [invalid ? "border-coral bg-coral-soft/40" : "", compact ? "min-h-10 text-sm" : ""].filter(Boolean).join(" ");
  const common = { id, name, disabled, className: cls, "aria-invalid": invalid || undefined };
  const v = inputValue(field, value);
  switch (field.type) {
    case "boolean":
      return (
        <Select {...common} defaultValue={v || "true"}>
          <option value="true">Kyllä</option>
          <option value="false">Ei</option>
        </Select>
      );
    case "provider":
      return (
        <Select {...common} defaultValue={v}>
          <option value="">Valitse urakoitsija</option>
          {(providers ?? []).map((p) => (
            <option key={p.id} value={p.id}>{p.name}</option>
          ))}
        </Select>
      );
    case "textarea":
      return <Textarea {...common} defaultValue={v} maxLength={4000} placeholder={placeholder} />;
    case "date":
      return <Input {...common} type="date" defaultValue={v} />;
    case "email":
      return <Input {...common} type="email" defaultValue={v} maxLength={254} placeholder={placeholder} autoComplete="off" />;
    case "money":
      return <Input {...common} inputMode="decimal" defaultValue={v} placeholder={placeholder} maxLength={14} />;
    case "integer":
      return <Input {...common} inputMode="numeric" defaultValue={v} placeholder={placeholder} maxLength={10} />;
    default:
      return <Input {...common} defaultValue={v} maxLength={200} placeholder={placeholder} />;
  }
}
