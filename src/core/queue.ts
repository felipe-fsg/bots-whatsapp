/**
 * Fila em memória que roda uma tarefa por vez para cada chave (cada grupo).
 * Assim duas fotos seguidas da mesma pessoa não contam o limite diário em paralelo.
 * Para mais de um servidor, troque por uma fila no Redis ou no Postgres.
 */
export class KeyedQueue {
  private readonly tails = new Map<string, Promise<void>>();

  run(key: string, task: () => Promise<void>): Promise<void> {
    const prev = this.tails.get(key) ?? Promise.resolve();
    const next = prev.then(task, task);
    const tail = next.catch(() => {});
    this.tails.set(key, tail);
    void tail.then(() => {
      if (this.tails.get(key) === tail) this.tails.delete(key);
    });
    return next;
  }

  async idle(): Promise<void> {
    while (this.tails.size) await Promise.all([...this.tails.values()]);
  }
}
