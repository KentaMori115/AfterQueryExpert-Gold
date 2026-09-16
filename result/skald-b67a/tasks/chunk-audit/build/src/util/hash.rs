//! Hash function collection — a faithful port of `util/hash.c`.
//!
//! Pure functions: data (+ optional seed) in, hash out. No allocation, no
//! global state.

pub fn fnv1a_32(data: &[u8]) -> u32 {
    let mut h: u32 = 2166136261;
    for &b in data {
        h ^= b as u32;
        h = h.wrapping_mul(16777619);
    }
    h
}

pub fn fnv1a_64(data: &[u8]) -> u64 {
    let mut h: u64 = 0xcbf29ce484222325;
    for &b in data {
        h ^= b as u64;
        h = h.wrapping_mul(0x100000001b3);
    }
    h
}

pub fn djb2(data: &[u8]) -> u32 {
    let mut h: u32 = 5381;
    for &b in data {
        h = h.wrapping_mul(33).wrapping_add(b as u32);
    }
    h
}

pub fn sdbm(data: &[u8]) -> u32 {
    let mut h: u32 = 0;
    for &b in data {
        h = (b as u32)
            .wrapping_add(h << 6)
            .wrapping_add(h << 16)
            .wrapping_sub(h);
    }
    h
}

pub fn murmur3_32(data: &[u8], seed: u32) -> u32 {
    const C1: u32 = 0xcc9e2d51;
    const C2: u32 = 0x1b873593;
    let mut h = seed;
    let nblocks = data.len() / 4;
    for i in 0..nblocks {
        let mut k = u32::from_le_bytes([
            data[i * 4],
            data[i * 4 + 1],
            data[i * 4 + 2],
            data[i * 4 + 3],
        ]);
        k = k.wrapping_mul(C1);
        k = k.rotate_left(15);
        k = k.wrapping_mul(C2);
        h ^= k;
        h = h.rotate_left(13);
        h = h.wrapping_mul(5).wrapping_add(0xe6546b64);
    }
    let tail = &data[nblocks * 4..];
    let mut k1: u32 = 0;
    if tail.len() >= 3 {
        k1 ^= (tail[2] as u32) << 16;
    }
    if tail.len() >= 2 {
        k1 ^= (tail[1] as u32) << 8;
    }
    if !tail.is_empty() {
        k1 ^= tail[0] as u32;
        k1 = k1.wrapping_mul(C1);
        k1 = k1.rotate_left(15);
        k1 = k1.wrapping_mul(C2);
        h ^= k1;
    }
    h ^= data.len() as u32;
    h ^= h >> 16;
    h = h.wrapping_mul(0x85ebca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2ae35);
    h ^= h >> 16;
    h
}

fn crc32_table() -> [u32; 256] {
    let mut table = [0u32; 256];
    let mut i = 0;
    while i < 256 {
        let mut c = i as u32;
        let mut k = 0;
        while k < 8 {
            c = if c & 1 != 0 {
                0xedb88320 ^ (c >> 1)
            } else {
                c >> 1
            };
            k += 1;
        }
        table[i] = c;
        i += 1;
    }
    table
}

pub fn crc32(data: &[u8]) -> u32 {
    let table = crc32_table();
    let mut crc: u32 = 0xffffffff;
    for &b in data {
        crc = table[((crc ^ b as u32) & 0xff) as usize] ^ (crc >> 8);
    }
    crc ^ 0xffffffff
}

pub fn xxhash32(data: &[u8], seed: u32) -> u32 {
    const P1: u32 = 2654435761;
    const P2: u32 = 2246822519;
    const P3: u32 = 3266489917;
    const P4: u32 = 668265263;
    const P5: u32 = 374761393;
    let mut h: u32;
    let mut idx = 0;
    if data.len() >= 16 {
        let mut v1 = seed.wrapping_add(P1).wrapping_add(P2);
        let mut v2 = seed.wrapping_add(P2);
        let mut v3 = seed;
        let mut v4 = seed.wrapping_sub(P1);
        while idx + 16 <= data.len() {
            let lane = |o: usize| {
                u32::from_le_bytes([
                    data[idx + o],
                    data[idx + o + 1],
                    data[idx + o + 2],
                    data[idx + o + 3],
                ])
            };
            v1 = v1
                .wrapping_add(lane(0).wrapping_mul(P2))
                .rotate_left(13)
                .wrapping_mul(P1);
            v2 = v2
                .wrapping_add(lane(4).wrapping_mul(P2))
                .rotate_left(13)
                .wrapping_mul(P1);
            v3 = v3
                .wrapping_add(lane(8).wrapping_mul(P2))
                .rotate_left(13)
                .wrapping_mul(P1);
            v4 = v4
                .wrapping_add(lane(12).wrapping_mul(P2))
                .rotate_left(13)
                .wrapping_mul(P1);
            idx += 16;
        }
        h = v1
            .rotate_left(1)
            .wrapping_add(v2.rotate_left(7))
            .wrapping_add(v3.rotate_left(12))
            .wrapping_add(v4.rotate_left(18));
    } else {
        h = seed.wrapping_add(P5);
    }
    h = h.wrapping_add(data.len() as u32);
    while idx + 4 <= data.len() {
        let lane = u32::from_le_bytes([
            data[idx],
            data[idx + 1],
            data[idx + 2],
            data[idx + 3],
        ]);
        h = h.wrapping_add(lane.wrapping_mul(P3));
        h = h.rotate_left(17).wrapping_mul(P4);
        idx += 4;
    }
    while idx < data.len() {
        h = h.wrapping_add((data[idx] as u32).wrapping_mul(P5));
        h = h.rotate_left(11).wrapping_mul(P1);
        idx += 1;
    }
    h ^= h >> 15;
    h = h.wrapping_mul(P2);
    h ^= h >> 13;
    h = h.wrapping_mul(P3);
    h ^= h >> 16;
    h
}

pub fn combine(h1: u64, h2: u64) -> u64 {
    h1 ^ (h2
        .wrapping_add(0x9e3779b97f4a7c15)
        .wrapping_add(h1 << 6)
        .wrapping_add(h1 >> 2))
}

pub fn hash_string(s: &[u8]) -> u64 {
    fnv1a_64(s)
}

pub fn hash_int64(v: i64) -> u64 {
    let mut key = v as u64;
    key = (!key).wrapping_add(key << 21);
    key ^= key >> 24;
    key = key.wrapping_add(key << 3).wrapping_add(key << 8);
    key ^= key >> 14;
    key = key.wrapping_add(key << 2).wrapping_add(key << 4);
    key ^= key >> 28;
    key = key.wrapping_add(key << 31);
    key
}

pub fn siphash_2_4(data: &[u8], key: [u64; 2]) -> u64 {
    let mut v0 = 0x736f6d6570736575 ^ key[0];
    let mut v1 = 0x646f72616e646f6d ^ key[1];
    let mut v2 = 0x6c7967656e657261 ^ key[0];
    let mut v3 = 0x7465646279746573 ^ key[1];

    macro_rules! round {
        () => {{
            v0 = v0.wrapping_add(v1);
            v1 = v1.rotate_left(13);
            v1 ^= v0;
            v0 = v0.rotate_left(32);
            v2 = v2.wrapping_add(v3);
            v3 = v3.rotate_left(16);
            v3 ^= v2;
            v0 = v0.wrapping_add(v3);
            v3 = v3.rotate_left(21);
            v3 ^= v0;
            v2 = v2.wrapping_add(v1);
            v1 = v1.rotate_left(17);
            v1 ^= v2;
            v2 = v2.rotate_left(32);
        }};
    }

    let len = data.len();
    let end = len - (len % 8);
    let mut i = 0;
    while i < end {
        let m = u64::from_le_bytes([
            data[i],
            data[i + 1],
            data[i + 2],
            data[i + 3],
            data[i + 4],
            data[i + 5],
            data[i + 6],
            data[i + 7],
        ]);
        v3 ^= m;
        round!();
        round!();
        v0 ^= m;
        i += 8;
    }
    let mut b: u64 = (len as u64) << 56;
    let tail = &data[end..];
    for (j, &t) in tail.iter().enumerate() {
        b |= (t as u64) << (8 * j);
    }
    v3 ^= b;
    round!();
    round!();
    v0 ^= b;
    v2 ^= 0xff;
    round!();
    round!();
    round!();
    round!();
    v0 ^ v1 ^ v2 ^ v3
}
