#!/usr/bin/env python3
"""Retenção dos backups locais do SQLite de desenvolvimento.

`db/` acumulava 29 cópias de `custom.db.backup.*` (33 MB) sem regra de descarte.
O roteiro mantém as `--keep` mais recentes por data de modificação e, além
dessas, todas as que casarem `--keep-pattern` — as cópias nomeadas por etapa
citada em documento, que são prova e não devem sumir por idade.

Simulação é o padrão; só `--apply` remove. A base ativa (`custom.db`) e seus
arquivos `-wal`/`-shm` nunca entram na lista.

    python3 scripts/prune-local-backups.py
    python3 scripts/prune-local-backups.py --keep 5 --keep-pattern etapa- --apply
"""
import argparse
import json
from pathlib import Path
import sys

PREFIXO = 'custom.db.backup.'


def argumentos(argv: list[str]) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--directory', default='db',
                        help='diretório com os backups (padrão: db)')
    parser.add_argument('--keep', type=int, default=5,
                        help='quantas cópias mais recentes preservar (padrão: 5)')
    parser.add_argument('--keep-pattern', action='append', default=[],
                        help='trecho de nome sempre preservado; pode repetir')
    parser.add_argument('--apply', action='store_true',
                        help='remove de fato; sem esta opção apenas simula')
    return parser.parse_args(argv)


def main(argv: list[str]) -> int:
    opcoes = argumentos(argv)
    if opcoes.keep < 0:
        print('--keep não aceita valor negativo.', file=sys.stderr)
        return 2

    diretorio = Path(opcoes.directory)
    if not diretorio.is_dir():
        print(f'Diretório inexistente: {diretorio}', file=sys.stderr)
        return 2

    copias = sorted(
        (caminho for caminho in diretorio.glob(f'{PREFIXO}*') if caminho.is_file()),
        key=lambda caminho: (caminho.stat().st_mtime, caminho.name),
        reverse=True,
    )

    protegidas: list[Path] = []
    candidatas: list[Path] = []
    for posicao, caminho in enumerate(copias):
        citada = any(trecho in caminho.name for trecho in opcoes.keep_pattern)
        if posicao < opcoes.keep or citada:
            protegidas.append(caminho)
        else:
            candidatas.append(caminho)

    removidas: list[str] = []
    if opcoes.apply:
        for caminho in candidatas:
            caminho.unlink()
            removidas.append(caminho.name)

    relatorio = {
        'directory': str(diretorio),
        'keep': opcoes.keep,
        'keepPattern': opcoes.keep_pattern,
        'applied': bool(opcoes.apply),
        'total': len(copias),
        'kept': len(protegidas),
        'keptNames': [caminho.name for caminho in protegidas],
        'removable': [caminho.name for caminho in candidatas],
        'removableBytes': sum(caminho.stat().st_size for caminho in candidatas)
        if not opcoes.apply else 0,
        'removed': len(removidas),
        'removedNames': removidas,
    }
    print(json.dumps(relatorio, ensure_ascii=False, indent=2))
    return 0


if __name__ == '__main__':
    raise SystemExit(main(sys.argv[1:]))
