import { Brand } from "@/components/Brand";

export const metadata = { title: "Ei käyttöoikeutta" };

export default function NoAccess() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-[var(--container-content)] flex-col justify-center px-5">
      <Brand size={28} />
      <h1 className="mt-8 text-3xl">Tunnuksellasi ei ole vielä käyttöoikeutta</h1>
      <p className="mt-3 text-ink/70">
        Käyttöoikeus syntyy, kun isännöitsijä kutsuu sinut taloyhtiön portaaliin tai lisää sinut henkilökuntaan. Ota
        yhteyttä taloyhtiösi isännöitsijään.
      </p>
      <a href="/kirjaudu/ulos" className="mt-8 text-sky">
        Kirjaudu ulos
      </a>
    </div>
  );
}
