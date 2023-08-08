export type mode = [
    { "text": "Normal mode (signal, exon and gene prediction)", "value": "normal" },
    { "text": "Exon mode (only signals and exons, omitting evidences)", "value": "-o" },
    { "text": "Assembling mode (only assembling evidences)", "value": "-O" }
]
export type strands = [
    { "text": "Forward and Reverse", "value": " " },
    { "text": "Reverse", "value": "-C" },
    { "text": "Forward", "value": "-W" }
]
export type output = [
    { "text": "geneid", "value": " " },
    { "text": "GFF", "value": "-G" },
    { "text": "gene including CDS sequence", "value": "-D" },
    { "text": "geneid extended (only genes)", "value": "-X" },
    { "text": "GFF extended (only genes)", "value": "-XG" }
]
export type signals = [
    { "text": "Acceptor sites", "value": "-a" },
    { "text": "Donor sites", "value": "-d" },
    { "text": "Start codons", "value": "-b" },
    { "text": "Stop codons", "value": "-e" }
]
export type exons = [
    { "text": "First exons", "value": "-f" },
    { "text": "Internal exons", "value": "-i" },
    { "text": "Terminal exons", "value": "-t" },
    { "text": "Single genes", "value": "-s" },
    { "text": "Open reading frames", "value": "-zZ" },
    { "text": "All exons", "value": "-x" }
]