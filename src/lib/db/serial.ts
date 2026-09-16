/**
 * Saman transaktion kyselyt jonoon. Sovellus kutsuu usein `Promise.all`:lla
 * useita kyselyjä samasta transaktiosta, mutta yksi pg-yhteys ajaa vain yhden
 * kyselyn kerrallaan: pg 8 jonottaa ne itse ja varoittaa ("client.query()
 * when the client is already executing a query"), pg 9 hylkää ne. Jono
 * säilyttää kutsujärjestyksen, eikä epäonnistunut kysely pysäytä seuraavia
 * (transaktio perutaan joka tapauksessa, kun virhe nousee kutsujalle).
 */
export function serialize<A extends unknown[], R>(fn: (...args: A) => Promise<R>): (...args: A) => Promise<R> {
  let tail: Promise<unknown> = Promise.resolve();
  return (...args: A) => {
    const next = tail.then(() => fn(...args));
    tail = next.catch(() => undefined);
    return next;
  };
}
