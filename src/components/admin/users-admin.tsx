"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Card, Chip, EmptyState, Field, PageTitle } from "@/components/ui";
import { ROLE_HINT, ROLE_LABEL } from "@/lib/labels";
import { ROLES, type Role, type Warehouse } from "@/lib/types";
import { createUser, updateUser } from "@/server/actions/admin";

export type AdminUser = {
  id: string;
  name: string;
  email: string;
  role: Role;
  phone: string | null;
  active: boolean;
  mustChangePassword: boolean;
  warehouseIds: string[];
};

type FormState = {
  id: string | null;
  name: string;
  email: string;
  role: Role;
  phone: string;
  active: boolean;
  password: string;
  warehouseIds: string[];
};

const NEW_USER: FormState = {
  id: null,
  name: "",
  email: "",
  role: "warehouse",
  phone: "",
  active: true,
  password: "",
  warehouseIds: [],
};

/** A temporary password that is easy to read out over the phone (no 0/O, 1/l). */
function generatePassword(): string {
  const alphabet = "abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789";
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => alphabet[b % alphabet.length]).join("");
}

function UserForm({
  initial,
  warehouses,
  soleOwner,
  onClose,
}: {
  initial: FormState;
  warehouses: Warehouse[];
  /** The only active owner: their role and access cannot be changed until another owner exists. */
  soleOwner: boolean;
  onClose: () => void;
}) {
  const router = useRouter();
  const toast = useToast();
  const [form, setForm] = useState(initial);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();
  const editing = form.id !== null;

  const toggleWarehouse = (id: string) =>
    setForm((f) => ({
      ...f,
      warehouseIds: f.warehouseIds.includes(id) ? f.warehouseIds.filter((w) => w !== id) : [...f.warehouseIds, id],
    }));

  const submit = () =>
    startTransition(async () => {
      const result = editing
        ? await updateUser({
            id: form.id,
            name: form.name,
            role: form.role,
            phone: form.phone,
            active: form.active,
            warehouseIds: form.warehouseIds,
            newPassword: form.password,
          })
        : await createUser({
            name: form.name,
            email: form.email,
            role: form.role,
            phone: form.phone,
            password: form.password,
            warehouseIds: form.warehouseIds,
          });
      setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
      if (toast.result(result)) {
        onClose();
        router.refresh();
      }
    });

  return (
    <Card className="mb-4 border-accent p-4">
      <form
        noValidate
        onSubmit={(e) => {
          e.preventDefault();
          submit();
        }}
        className="flex flex-col gap-4"
      >
        <p className="text-base font-extrabold">{editing ? `Edit ${initial.name}` : "Add a user"}</p>

        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Name" htmlFor="u-name" required error={errors.name}>
            <input id="u-name" className="input" value={form.name} maxLength={80} onChange={(e) => setForm({ ...form, name: e.target.value })} aria-invalid={Boolean(errors.name)} />
          </Field>
          <Field label="Phone" htmlFor="u-phone" error={errors.phone}>
            <input id="u-phone" className="input" type="tel" inputMode="tel" value={form.phone} maxLength={20} onChange={(e) => setForm({ ...form, phone: e.target.value })} />
          </Field>
        </div>

        {editing ? (
          <p className="text-sm text-muted">
            Sign-in email: <span className="break-all font-mono text-ink">{form.email}</span>
          </p>
        ) : (
          <Field label="Email" htmlFor="u-email" required error={errors.email} hint="They sign in with this. It cannot be changed later.">
            <input id="u-email" className="input" type="email" inputMode="email" autoCapitalize="none" autoCorrect="off" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} aria-invalid={Boolean(errors.email)} />
          </Field>
        )}

        <Field label="Role" htmlFor="u-role" required error={errors.role} hint={soleOwner ? "You are the only owner. Make someone else an owner before changing your own role." : ROLE_HINT[form.role]}>
          <select id="u-role" className="input" value={form.role} disabled={soleOwner} onChange={(e) => setForm({ ...form, role: e.target.value as Role })}>
            {ROLES.map((r) => (
              <option key={r} value={r}>
                {ROLE_LABEL[r]}
              </option>
            ))}
          </select>
        </Field>

        <fieldset>
          <legend className="mb-1.5 text-sm font-semibold">
            Warehouses
            {form.role === "warehouse" ? <span className="text-bad"> *</span> : <span className="font-normal text-muted"> (optional)</span>}
          </legend>
          <div className="flex flex-wrap gap-2">
            {warehouses.map((w) => {
              const on = form.warehouseIds.includes(w.id);
              return (
                <button
                  key={w.id}
                  type="button"
                  aria-pressed={on}
                  onClick={() => toggleWarehouse(w.id)}
                  className={`focus-ring min-h-11 rounded-full border px-4 text-sm font-bold ${
                    on ? "border-accent bg-accent text-accent-ink" : "border-line bg-surface text-muted"
                  }`}
                >
                  {w.name}
                </button>
              );
            })}
          </div>
          {errors.warehouseIds ? <p className="mt-1.5 text-sm font-medium text-bad">{errors.warehouseIds}</p> : null}
        </fieldset>

        <Field
          label={editing ? "New temporary password" : "Temporary password"}
          htmlFor="u-password"
          required={!editing}
          error={errors.password ?? errors.newPassword}
          hint={
            editing
              ? "Leave empty to keep their current password. If you set one, they must change it at next sign-in."
              : "At least 8 characters. They must change it the first time they sign in."
          }
        >
          <div className="flex gap-2">
            <input id="u-password" className="input min-w-0 font-mono" value={form.password} autoComplete="off" autoCapitalize="none" autoCorrect="off" spellCheck={false} onChange={(e) => setForm({ ...form, password: e.target.value })} aria-invalid={Boolean(errors.password ?? errors.newPassword)} />
            <button type="button" onClick={() => setForm({ ...form, password: generatePassword() })} className={buttonClass("secondary", "shrink-0")}>
              Generate
            </button>
          </div>
        </Field>

        {editing && !soleOwner ? (
          <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
            <input type="checkbox" className="h-5 w-5 accent-(--accent)" checked={form.active} onChange={(e) => setForm({ ...form, active: e.target.checked })} />
            Active (untick to block sign-in; their posts and history stay)
          </label>
        ) : null}

        <div className="flex flex-col gap-2 sm:flex-row-reverse sm:justify-start">
          <button type="submit" disabled={pending} className={buttonClass("primary", "sm:min-w-36")}>
            {pending ? "Saving…" : editing ? "Save user" : "Add user"}
          </button>
          <button type="button" onClick={onClose} className={buttonClass("secondary")}>
            Cancel
          </button>
        </div>
      </form>
    </Card>
  );
}

export function UsersAdmin({ users, warehouses, meId }: { users: AdminUser[]; warehouses: Warehouse[]; meId: string }) {
  const [editing, setEditing] = useState<FormState | null>(null);
  const warehouseName = new Map(warehouses.map((w) => [w.id, w.name]));
  const owners = users.filter((u) => u.role === "owner" && u.active);
  const soleOwnerId = owners.length === 1 ? owners[0].id : null;

  return (
    <div className="mx-auto max-w-3xl">
      <PageTitle
        title="Users"
        sub={`${users.filter((u) => u.active).length} active · ${users.length} total`}
        action={
          editing ? null : (
            <button type="button" onClick={() => setEditing(NEW_USER)} className={buttonClass("primary", "shrink-0")}>
              + Add user
            </button>
          )
        }
      />

      {editing ? (
        <UserForm
          key={editing.id ?? "new"}
          initial={editing}
          warehouses={warehouses}
          soleOwner={editing.id !== null && editing.id === soleOwnerId}
          onClose={() => setEditing(null)}
        />
      ) : null}

      {users.length ? (
        <ul className="flex flex-col gap-2">
          {users.map((u) => (
            <li key={u.id}>
              <button
                type="button"
                onClick={() => {
                  setEditing({ id: u.id, name: u.name, email: u.email, role: u.role, phone: u.phone ?? "", active: u.active, password: "", warehouseIds: u.warehouseIds });
                  window.scrollTo({ top: 0, behavior: "smooth" });
                }}
                className={`focus-ring w-full rounded-xl border border-line bg-surface p-3 text-left transition hover:border-accent ${u.active ? "" : "opacity-60"}`}
              >
                <span className="flex flex-wrap items-center gap-1.5">
                  <span className="text-[15px] font-bold">{u.name}</span>
                  {u.id === meId ? <Chip tone="accent">You</Chip> : null}
                  <span className="ml-auto flex gap-1.5">
                    {!u.active ? <Chip tone="bad">Deactivated</Chip> : u.mustChangePassword ? <Chip tone="warn">Temp password</Chip> : null}
                    <Chip tone={u.role === "owner" ? "accent" : "neutral"}>{ROLE_LABEL[u.role]}</Chip>
                  </span>
                </span>
                <span className="mt-1 block break-all font-mono text-xs text-muted">{u.email}</span>
                <span className="mt-1 block text-xs text-muted">
                  {u.warehouseIds.length
                    ? u.warehouseIds.map((id) => warehouseName.get(id) ?? "Unknown").join(", ")
                    : u.role === "warehouse"
                      ? "No warehouse assigned"
                      : "All warehouses"}
                </span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title="No users yet" body="Add the first team member. They sign in with the email and temporary password you set here." />
      )}
    </div>
  );
}
