"""Read-only inventory of a Word report template's slots and table captions."""

import re
import sys
import zipfile
from collections import Counter
from xml.etree import ElementTree as ET

NS = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}
SLOT = re.compile(r"\{\{([^{}]+)\}\}")


def text(element):
    return "".join(node.text or "" for node in element.findall(".//w:t", NS))


with zipfile.ZipFile(sys.argv[1]) as archive:
    parts = [name for name in archive.namelist() if re.fullmatch(r"word/(document|header\d+|footer\d+)\.xml", name)]
    slots = Counter()
    print("PARTS", len(parts))
    for name in parts:
        root = ET.fromstring(archive.read(name))
        paragraphs = root.findall(".//w:p", NS)
        tables = root.findall(".//w:tbl", NS)
        print("PART", name, "paragraphs", len(paragraphs), "tables", len(tables))
        for paragraph in paragraphs:
            content = text(paragraph)
            slots.update(SLOT.findall(content))
        if name == "word/document.xml":
            body = root.find("w:body", NS)
            for element in body:
                if element.tag.endswith("}p"):
                    content = text(element).strip()
                    if SLOT.search(content) or re.search(r"^(表|图)[A-Z]?[-－]?\d|^(附录|[A-Z]\.\d)", content):
                        print("P", content[:180])
                elif element.tag.endswith("}tbl"):
                    rows = element.findall("w:tr", NS)
                    sample = []
                    for row in rows[:3]:
                        sample.append(" | ".join(text(cell).strip()[:60] for cell in row.findall("w:tc", NS)))
                    print("TABLE", len(rows), "rows", " / ".join(sample)[:250])
    print("UNIQUE_SLOTS", len(slots), "OCCURRENCES", sum(slots.values()))
    for key, count in slots.most_common():
        print("SLOT", count, repr(key))
