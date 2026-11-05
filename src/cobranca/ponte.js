// Ponte mínima entre o módulo de cobrança e o Balbino Chat.
// O servidor do Balbino registra aqui as funções que o módulo pode usar; o módulo nunca importa server.js.
export const ponte = {
  nomeUsuario: id => id || null,
  travaMinutos: () => Number(process.env.BALBINO_COBRANCA_TRAVA_MINUTOS || 30),
};
export function registrarPonte(funcoes) { Object.assign(ponte, funcoes); }

// Usuário do Balbino -> usuário da cobrança. Só o SUPER_ADMIN do Balbino administra a cobrança de todas as instituições.
// Módulos liberados para o usuário. SUPER_ADMIN sempre tem os dois.
// Lido do banco da cobrança; a função é injetada por db.js para evitar dependência circular.
let lerModulos = () => null;
export function definirLeitorModulos(fn) { lerModulos = fn; }
export function modulosDe(u) {
  if (!u) return { atendimento: false, cobranca: false };
  if (u.role === 'SUPER_ADMIN') return { atendimento: true, cobranca: true };
  const m = lerModulos(u.id);
  return { atendimento: m ? m.atendimento === 1 : true, cobranca: m ? m.cobranca === 1 : true };
}

export function usuarioCobranca(u) {
  if (!u) return null;
  return { id: u.id, nome: u.name || u.username, admin: u.role === 'SUPER_ADMIN', papelBalbino: u.role };
}
