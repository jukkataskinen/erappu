import { notFound } from "next/navigation";
import { FormError } from "@/components/FormError";
import { Badge, Button, DefinitionList, PageHeader, Panel } from "@/components/ui";
import { requireStaff } from "@/lib/auth/current-user";
import { formatDate, formatDateTime } from "@/lib/format";
import { listCompanies, listStaff } from "@/lib/registry/queries";
import { TASK_CATEGORY_LABEL } from "@/lib/tasks/labels";
import { getTask } from "@/lib/tasks/queries";
import { describeRecurrence } from "@/lib/tasks/recurrence";
import { completeTaskAction, deleteTaskAction, reopenTaskAction } from "../actions";
import { TaskForm } from "../TaskForm";

export const metadata = { title: "Tehtävä" };

export default async function TaskPage({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ virhe?: string }> }) {
  const ctx = await requireStaff();
  const { id } = await params;
  const { virhe } = await searchParams;
  if (!/^[0-9a-f-]{36}$/i.test(id)) notFound();
  const [task, companies, staff] = await ctx.run((tx) => Promise.all([getTask(tx, id), listCompanies(tx, ctx.org.organizationId), listStaff(tx, ctx.org.organizationId)]));
  if (!task || task.organization_id !== ctx.org.organizationId) notFound();

  return (
    <>
      <PageHeader
        title={task.title}
        subtitle={task.company_name ?? "Toimiston tehtävä"}
        back={{ href: "/vuosikello", label: "Vuosikello" }}
        actions={
          task.done_at ? (
            <form action={reopenTaskAction}>
              <input type="hidden" name="id" value={task.id} />
              <Button variant="secondary">Palauta avoimeksi</Button>
            </form>
          ) : (
            <form action={completeTaskAction}>
              <input type="hidden" name="id" value={task.id} />
              <Button>Kuittaa tehdyksi</Button>
            </form>
          )
        }
      />
      <FormError message={virhe} />
      {task.done_at ? (
        <Panel className="max-w-3xl">
          <div className="mb-4">
            <Badge tone="ok">Kuitattu</Badge>
          </div>
          <DefinitionList
            items={[
              { label: "Eräpäivä", value: formatDate(task.due_on) },
              { label: "Luokka", value: TASK_CATEGORY_LABEL[task.category] },
              { label: "Kuitattu", value: `${formatDateTime(task.done_at)}${task.done_by_name ? `, ${task.done_by_name}` : ""}` },
              { label: "Toistuu", value: describeRecurrence(task.recurrence) },
              { label: "Kuvaus", value: task.description },
            ]}
          />
        </Panel>
      ) : (
        <div className="grid max-w-3xl gap-6">
          <TaskForm task={task} companies={companies} staff={staff} />
          <form action={deleteTaskAction}>
            <input type="hidden" name="id" value={task.id} />
            <Button variant="ghost" className="text-coral">Poista tehtävä</Button>
          </form>
        </div>
      )}
    </>
  );
}
