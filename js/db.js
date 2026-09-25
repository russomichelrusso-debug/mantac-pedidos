// Armazenamento chave/valor em IndexedDB (dataset, configurações, orçamento).
const NOME = 'mantac-pedidos';
let conexao;

function abrir() {
  if (conexao) return conexao;
  conexao = new Promise((ok, erro) => {
    const req = indexedDB.open(NOME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore('kv');
    req.onsuccess = () => ok(req.result);
    req.onerror = () => erro(req.error);
  });
  return conexao;
}

async function tx(modo, fn) {
  const db = await abrir();
  return new Promise((ok, erro) => {
    const t = db.transaction('kv', modo);
    const req = fn(t.objectStore('kv'));
    t.oncomplete = () => ok(req?.result);
    t.onerror = () => erro(t.error);
  });
}

export const ler = (chave) => tx('readonly', (s) => s.get(chave));
export const gravar = (chave, valor) => tx('readwrite', (s) => s.put(valor, chave));
export const apagar = (chave) => tx('readwrite', (s) => s.delete(chave));
