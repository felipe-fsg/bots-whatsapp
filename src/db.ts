import postgres from 'postgres';

export type Sql = postgres.Sql;

export function connect(url: string): Sql {
  return postgres(url, {
    max: 10,
    onnotice: () => {},
    types: {
      // numeric vem como string por padrão; aqui pontos são números pequenos
      // date fica como texto 'yyyy-MM-dd', sem confusão de fuso horário
      date: { to: 1082, from: [1082], serialize: (v: string) => v, parse: (v: string) => v },
      numeric: { to: 1700, from: [1700], serialize: (v: number) => String(v), parse: (v: string) => Number(v) },
    },
  });
}
