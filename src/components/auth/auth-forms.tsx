"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { useToast } from "@/components/toast";
import { buttonClass, Field } from "@/components/ui";
import { redactSecrets } from "@/lib/redact";
import { changePassword, signIn } from "@/server/actions/auth";

export function LoginForm({ notice }: { notice?: string }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(notice ?? null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await signIn({ email, password });
          if (result.ok) {
            router.replace("/");
            router.refresh();
            return;
          }
          setError(redactSecrets(result.message));
          setErrors(result.fieldErrors ?? {});
        });
      }}
      className="flex flex-col gap-4"
    >
      {error ? (
        <p role="alert" className="rounded-lg bg-bad-soft px-3 py-2 text-sm font-semibold text-bad">
          {error}
        </p>
      ) : null}
      <Field label="Email" htmlFor="email" required error={errors.email}>
        <input id="email" name="email" type="email" inputMode="email" autoComplete="username" autoCapitalize="none" autoCorrect="off" className="input" value={email} onChange={(e) => setEmail(e.target.value)} aria-invalid={Boolean(errors.email)} />
      </Field>
      <Field label="Password" htmlFor="password" required error={errors.password}>
        <input id="password" name="password" type="password" autoComplete="current-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} />
      </Field>
      <button type="submit" disabled={pending} className={buttonClass("primary", "mt-1 w-full")}>
        {pending ? "Signing in…" : "Sign in"}
      </button>
      <p className="text-center text-sm text-muted">No account or forgot your password? Ask the owner to set one for you.</p>
    </form>
  );
}

export function ChangePasswordForm() {
  const router = useRouter();
  const toast = useToast();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [show, setShow] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [pending, startTransition] = useTransition();

  return (
    <form
      noValidate
      onSubmit={(e) => {
        e.preventDefault();
        startTransition(async () => {
          const result = await changePassword({ password, confirm });
          setErrors(result.ok ? {} : (result.fieldErrors ?? {}));
          if (toast.result(result)) {
            router.replace("/");
            router.refresh();
          }
        });
      }}
      className="flex flex-col gap-4"
    >
      <Field label="New password" htmlFor="new-password" required error={errors.password} hint="At least 8 characters.">
        <input id="new-password" type={show ? "text" : "password"} autoComplete="new-password" className="input" value={password} onChange={(e) => setPassword(e.target.value)} aria-invalid={Boolean(errors.password)} />
      </Field>
      <Field label="Type it again" htmlFor="confirm-password" required error={errors.confirm}>
        <input id="confirm-password" type={show ? "text" : "password"} autoComplete="new-password" className="input" value={confirm} onChange={(e) => setConfirm(e.target.value)} aria-invalid={Boolean(errors.confirm)} />
      </Field>
      <label className="flex min-h-11 items-center gap-3 text-sm font-semibold">
        <input type="checkbox" className="h-5 w-5 accent-(--accent)" checked={show} onChange={(e) => setShow(e.target.checked)} />
        Show password
      </label>
      <button type="submit" disabled={pending} className={buttonClass("primary", "w-full")}>
        {pending ? "Saving…" : "Save password"}
      </button>
    </form>
  );
}
