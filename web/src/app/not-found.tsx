import Link from "next/link";
import { MarcaSimbolo } from "@/components/marca/Marca";

export const metadata = { title: "Página não encontrada", robots: { index: false } };

export default function NaoEncontrada() {
  return (
    <main className="dv-raiz min-h-screen flex items-center justify-center px-4 text-center" style={{ background: "#040807", color: "#f4f8f6" }}>
      <div className="max-w-[480px]">
        <MarcaSimbolo animada cor="#5cb98d" className="mx-auto w-16 h-16" />
        <h1 className="dv-h2 mt-8">Essa página não existe</h1>
        <p className="dv-corpo mt-4" style={{ color: "#9fb2aa" }}>O endereço pode ter mudado ou estar digitado errado. Volte ao início ou entre no seu portal.</p>
        <div className="mt-8 flex flex-wrap justify-center gap-3">
          <Link href="/" className="dv-foco h-12 px-6 rounded-full inline-flex items-center font-semibold" style={{ background: "#f4f6f6", color: "#07100d" }}>Ir para o início</Link>
          <Link href="/login" className="dv-foco h-12 px-6 rounded-full inline-flex items-center font-semibold" style={{ border: "1px solid rgb(255 255 255 / .2)", color: "#f4f6f6" }}>Entrar</Link>
        </div>
      </div>
    </main>
  );
}
