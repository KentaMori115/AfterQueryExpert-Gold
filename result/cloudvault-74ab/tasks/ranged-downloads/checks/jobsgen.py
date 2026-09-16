"""The randomised sweep both the cross-check and the mutation battery run on."""
import random

TYPES = ["video/mp4", "application/pdf", "image/png", "application/octet-stream", "text/plain"]
BOUNDARIES = ["cloudvault-71f3c0", "b", "cv--boundary--0123456789abcdef", "part7"]


def build(seed=20260905, count=4000):
    rng = random.Random(seed)

    def manifest():
        return {"chunkSizes": [rng.randint(1, 4000) for _ in range(rng.randint(1, 5))],
                "contentType": rng.choice(TYPES)}

    def header(total):
        r = rng.random()
        for edge, text in ((0.05, None), (0.08, ""), (0.11, "items=0-10"), (0.14, "bytes="),
                           (0.17, "bytes=abc"), (0.20, "bytes=0-10,"), (0.23, "bytes=-"), (0.26, "bytes=5-1")):
            if r < edge:
                return text
        members = []
        for _ in range(rng.randint(1, 7)):
            k = rng.random()
            if k < 0.15:
                members.append("-%d" % rng.randint(0, total + 50))
            elif k < 0.3:
                members.append("%d-" % rng.randint(0, total + 50))
            else:
                a = rng.randint(0, total + 20)
                members.append("%d-%d" % (a, a + rng.randint(0, 300)))
        return "bytes=" + ",".join(members)

    out = []
    for _ in range(count):
        m = manifest()
        out.append({"manifest": m, "header": header(sum(m["chunkSizes"])), "boundary": rng.choice(BOUNDARIES)})

    # A uniform sweep lands on an exact edge about never: with a file of a few
    # thousand bytes, "a member starting on the byte after the last" comes up
    # once in some thousands of draws. So the edges are asked for by name, or a
    # mutation that only moves an edge reads as though it moved nothing.
    for _ in range(count // 4):
        m = manifest()
        total = sum(m["chunkSizes"])
        edges = ["%d-" % total, "%d-" % (total - 1), "%d-" % (total + 1), "-0", "-1",
                 "-%d" % total, "-%d" % (total - 1), "-%d" % (total + 1),
                 "0-%d" % (total - 1), "0-%d" % total, "%d-%d" % (total - 1, total),
                 "0-0", "%d-%d" % (total - 1, total - 1)]
        picked = [rng.choice(edges) for _ in range(rng.randint(1, 3))]
        if rng.random() < 0.5:
            a = rng.randint(0, max(0, total - 1))
            picked.append("%d-%d" % (a, a + rng.randint(0, 300)))
        out.append({"manifest": m, "header": "bytes=" + ",".join(picked),
                    "boundary": rng.choice(BOUNDARIES)})
    return out


jobs = build()
