with open(meta_sh, "w", encoding="utf-8") as f:
    # meta.sh contract: bin/tool-runner (tool_meta) consumes these TOOL_-prefixed names
    for k in ("tool_id", "version", "kind", "main_bin", "glibc_max", "elf_arch"):
        f.write("%s=%s\n" % (k.upper(), shlex.quote(fields[k] or "")))
    f.write("UNAVAILABLE=%s\n" % ("1" if fields["unavailable"] else "0"))
print("meta written:", meta_json)
