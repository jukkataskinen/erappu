import { Button, Field, Input, Panel, Select, Textarea } from "@/components/ui";
import { TASK_CATEGORIES, TASK_CATEGORY_LABEL } from "@/lib/tasks/labels";
import type { TaskRow } from "@/lib/tasks/queries";
import { createTaskAction, updateTaskAction } from "./actions";

export function TaskForm({
  task, companies, staff, defaults,
}: {
  task?: TaskRow | null;
  companies: { id: string; name: string }[];
  staff: { id: string; name: string }[];
  defaults?: { companyId?: string; assigneeUserId?: string; dueOn?: string };
}) {
  const r = task?.recurrence;
  return (
    <form action={task ? updateTaskAction : createTaskAction}>
      {task ? <input type="hidden" name="id" value={task.id} /> : null}
      <Panel>
        <div className="grid gap-4 sm:grid-cols-2">
          <div className="sm:col-span-2">
            <Field label="Tehtävä" htmlFor="title">
              <Input id="title" name="title" required maxLength={200} defaultValue={task?.title} />
            </Field>
          </div>
          <Field label="Taloyhtiö" htmlFor="company_id" hint="Jätä tyhjäksi, jos tehtävä koskee koko toimistoa.">
            <Select id="company_id" name="company_id" defaultValue={task?.company_id ?? defaults?.companyId ?? ""}>
              <option value="">Ei yhtiötä</option>
              {companies.map((c) => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Luokka" htmlFor="category">
            <Select id="category" name="category" defaultValue={task?.category ?? "other"}>
              {TASK_CATEGORIES.map((c) => (
                <option key={c} value={c}>{TASK_CATEGORY_LABEL[c]}</option>
              ))}
            </Select>
          </Field>
          <Field label="Eräpäivä" htmlFor="due_on">
            <Input id="due_on" name="due_on" type="date" required defaultValue={task?.due_on ?? defaults?.dueOn} />
          </Field>
          <Field label="Vastuuhenkilö" htmlFor="assignee_user_id" hint="Saa muistutuksen sähköpostiin eräpäivänä.">
            <Select id="assignee_user_id" name="assignee_user_id" defaultValue={task?.assignee_user_id ?? defaults?.assigneeUserId ?? ""}>
              <option value="">Ei vastuuhenkilöä</option>
              {staff.map((s) => (
                <option key={s.id} value={s.id}>{s.name}</option>
              ))}
            </Select>
          </Field>
          <Field label="Toistuu" htmlFor="freq" hint="Kun toistuva tehtävä kuitataan, seuraava luodaan automaattisesti.">
            <Select id="freq" name="freq" defaultValue={r?.freq ?? "none"}>
              <option value="none">Ei toistu</option>
              <option value="yearly">Vuosittain</option>
              <option value="monthly">Kuukausittain</option>
              <option value="weekly">Viikoittain</option>
            </Select>
          </Field>
          <Field label="Toistoväli" htmlFor="interval" hint="Esim. 3 ja kuukausittain = neljännesvuosittain.">
            <Input id="interval" name="interval" type="number" min={1} max={120} defaultValue={r?.interval ?? 1} />
          </Field>
          <div className="sm:col-span-2">
            <Field label="Kuvaus" htmlFor="description">
              <Textarea id="description" name="description" maxLength={4000} defaultValue={task?.description ?? ""} />
            </Field>
          </div>
        </div>
        <div className="mt-5">
          <Button>{task ? "Tallenna muutokset" : "Lisää tehtävä"}</Button>
        </div>
      </Panel>
    </form>
  );
}
