//! Integration tests for skald's data-structure, utility, and standard-library
//! subsystems. These exercise the safe, self-contained modules end to end.
//! Graded as inherited behaviour: this file is restored from the base
//! commit before it runs, so edits made alongside a change are ignored.

use skald::ds::{btree::BTree, deque::Deque, graph::Graph, pqueue::PQueue, rbtree::RbTree,
    set::HxSet, skiplist::SkipList};
use skald::stdlib::{buffer, crypto, fmt, io, matrix::Matrix, os, regex::Regex};
use skald::util::{bitset::Bitset, hash, sort, strbuf::StrBuf, utf8};

// ── deque ────────────────────────────────────────────────────────────────

#[test]
fn deque_push_pop_both_ends() {
    let mut d = Deque::new(0);
    d.push_back(1);
    d.push_back(2);
    d.push_front(0);
    assert_eq!(d.len(), 3);
    assert_eq!(d.peek_front(), Some(0));
    assert_eq!(d.peek_back(), Some(2));
    assert_eq!(d.pop_front(), Some(0));
    assert_eq!(d.pop_back(), Some(2));
    assert_eq!(d.pop_front(), Some(1));
    assert!(d.is_empty());
}

#[test]
fn deque_grows_and_rotates() {
    let mut d = Deque::new(2);
    for i in 0..10 {
        d.push_back(i);
    }
    assert_eq!(d.len(), 10);
    d.rotate_left(3);
    assert_eq!(d.peek_front(), Some(3));
    d.rotate_right(3);
    assert_eq!(d.peek_front(), Some(0));
}

// ── priority queue ────────────────────────────────────────────────────────

#[test]
fn pqueue_min_order() {
    let mut pq = PQueue::new(0);
    pq.push(100, 5);
    pq.push(200, 1);
    pq.push(300, 3);
    assert_eq!(pq.peek().unwrap().data, 200);
    assert_eq!(pq.pop().unwrap().data, 200);
    assert_eq!(pq.pop().unwrap().data, 300);
    assert_eq!(pq.pop().unwrap().data, 100);
    assert!(pq.is_empty());
}

#[test]
fn pqueue_update_priority() {
    let mut pq = PQueue::new(0);
    pq.push(1, 10);
    pq.push(2, 20);
    assert!(pq.update_priority(2, 1));
    assert_eq!(pq.pop().unwrap().data, 2);
}

// ── hash set ───────────────────────────────────────────────────────────────

#[test]
fn set_insert_contains_remove() {
    let mut s = HxSet::new(0);
    assert!(s.insert(b"alpha"));
    assert!(s.insert(b"beta"));
    assert!(s.insert(b"alpha")); // duplicate no-op
    assert_eq!(s.size(), 2);
    assert!(s.contains(b"alpha"));
    assert!(s.remove(b"alpha"));
    assert!(!s.contains(b"alpha"));
    assert_eq!(s.size(), 1);
}

#[test]
fn set_resizes_under_load() {
    let mut s = HxSet::new(4);
    for i in 0..200u32 {
        s.insert(&i.to_le_bytes());
    }
    assert_eq!(s.size(), 200);
    for i in 0..200u32 {
        assert!(s.contains(&i.to_le_bytes()));
    }
}

// ── skip list ──────────────────────────────────────────────────────────────

#[test]
fn skiplist_ordered_lookup() {
    let mut sl = SkipList::new();
    sl.insert(b"banana", 2);
    sl.insert(b"apple", 1);
    sl.insert(b"cherry", 3);
    assert_eq!(sl.lookup(b"apple"), Some(1));
    assert_eq!(sl.lookup(b"cherry"), Some(3));
    assert_eq!(sl.size(), 3);
    let (k, _) = sl.nth(0).unwrap();
    assert_eq!(k, b"apple");
    assert_eq!(sl.floor_key(b"bb").unwrap(), b"banana");
}

// ── b-tree ─────────────────────────────────────────────────────────────────

#[test]
fn btree_insert_and_scan() {
    let mut t = BTree::new();
    for i in (0..100).rev() {
        t.insert(i, (i * 2) as u64);
    }
    assert_eq!(t.size(), 100);
    assert_eq!(t.lookup(42), Some(84));
    let ordered = t.in_order();
    assert!(ordered.windows(2).all(|w| w[0].0 < w[1].0));
    let r = t.range(10, 20);
    assert_eq!(r.len(), 11);
}

// ── red-black tree ─────────────────────────────────────────────────────────

#[test]
fn rbtree_balanced_lookup() {
    let mut t = RbTree::new();
    for i in 0..500 {
        t.insert(i, i as u64);
    }
    assert_eq!(t.size(), 500);
    assert_eq!(t.lookup(250), Some(250));
    assert_eq!(t.min_key(), Some(0));
    assert_eq!(t.max_key(), Some(499));
    let ordered = t.in_order();
    assert!(ordered.windows(2).all(|w| w[0].0 < w[1].0));
}

// ── graph ──────────────────────────────────────────────────────────────────

#[test]
fn graph_traversals_and_dijkstra() {
    let mut g = Graph::new(6, true);
    g.add_edge(0, 1, 7);
    g.add_edge(0, 2, 9);
    g.add_edge(1, 3, 15);
    g.add_edge(2, 3, 11);
    g.add_edge(3, 5, 6);
    let dist = g.dijkstra(0);
    assert_eq!(dist[3], 20);
    assert_eq!(dist[5], 26);
    assert_eq!(g.bfs(0).len(), 5);
    assert!(g.topo_sort().is_some());
}

#[test]
fn graph_components() {
    let mut g = Graph::new(6, false);
    g.add_edge(0, 1, 1);
    g.add_edge(2, 3, 1);
    // components: {0,1}, {2,3}, {4}, {5}
    assert_eq!(g.connected_components(), 4);
}

// ── hashing ────────────────────────────────────────────────────────────────

#[test]
fn hash_functions_are_deterministic() {
    let data = b"the quick brown fox";
    assert_eq!(hash::fnv1a_64(data), hash::fnv1a_64(data));
    assert_ne!(hash::fnv1a_32(data), 0);
    assert_ne!(hash::crc32(data), hash::crc32(b"other"));
    assert_eq!(hash::murmur3_32(data, 0), hash::murmur3_32(data, 0));
}

// ── bitset ─────────────────────────────────────────────────────────────────

#[test]
fn bitset_ops() {
    let mut a = Bitset::new(128);
    a.set(3);
    a.set(64);
    a.set(120);
    assert!(a.get(64));
    assert_eq!(a.popcount(), 3);
    assert_eq!(a.find_first_set(), Some(3));
    a.clear(3);
    assert_eq!(a.find_first_set(), Some(64));
}

// ── sorting ────────────────────────────────────────────────────────────────

#[test]
fn sorts_match_reference() {
    let base: Vec<i64> = vec![5, 3, 8, 1, 9, 2, 7, 4, 6, 0];
    for sorter in [sort::quicksort, sort::merge_sort, sort::heap_sort] {
        let mut v = base.clone();
        sorter(&mut v);
        assert!(sort::is_sorted(&v));
    }
    let mut v = base.clone();
    sort::quicksort(&mut v);
    assert_eq!(sort::binary_search(&v, 7), Some(7));
    assert_eq!(sort::lower_bound(&v, 5), 5);
}

// ── utf8 ───────────────────────────────────────────────────────────────────

#[test]
fn utf8_roundtrip() {
    let s = "héllo wörld ☃".as_bytes();
    assert!(utf8::validate(s));
    assert_eq!(utf8::char_count(s), "héllo wörld ☃".chars().count());
    let mut buf = [0u8; 4];
    let n = utf8::encode(0x2603, &mut buf);
    assert_eq!(&buf[..n], "☃".as_bytes());
}

// ── strbuf ─────────────────────────────────────────────────────────────────

#[test]
fn strbuf_builds_and_transforms() {
    let mut sb = StrBuf::new(0);
    sb.append_str("Hello");
    sb.append_char(b' ');
    sb.append_str("World");
    assert_eq!(sb.len(), 11);
    sb.to_upper();
    assert_eq!(sb.as_bytes(), b"HELLO WORLD");
    assert_eq!(sb.replace_all(b"L", b"1"), 3);
    assert_eq!(sb.as_bytes(), b"HE11O WOR1D");
}

// ── crypto ─────────────────────────────────────────────────────────────────

#[test]
fn sha256_known_vector() {
    // SHA-256("abc")
    assert_eq!(
        crypto::sha256_hex(b"abc"),
        "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad"
    );
    assert_eq!(
        crypto::sha256_hex(b""),
        "e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855"
    );
}

#[test]
fn base64_roundtrip() {
    let data = b"skald encoding test \x00\xff";
    let enc = crypto::base64_encode(data);
    assert_eq!(crypto::base64_decode(enc.as_bytes()), data);
}

// ── regex ──────────────────────────────────────────────────────────────────

#[test]
fn regex_basic_matches() {
    assert!(Regex::compile(b"a.c").is_match(b"abc"));
    assert!(Regex::compile(b"ab*c").is_match(b"ac"));
    assert!(Regex::compile(b"ab+c").is_match(b"abbbc"));
    assert!(!Regex::compile(b"ab+c").is_match(b"ac"));
    assert!(Regex::compile(b"[0-9]+").is_match(b"year 2026"));
    assert!(Regex::compile(b"^hello").is_match(b"hello world"));
    assert!(!Regex::compile(b"^world").is_match(b"hello world"));
}

// ── buffer ─────────────────────────────────────────────────────────────────

#[test]
fn buffer_roundtrip() {
    let mut w = buffer::ByteWriter::new();
    w.u8(0xAB);
    w.u32_le(0xDEADBEEF);
    w.varint(300);
    w.f64_le(3.5);
    let bytes = w.take();
    let mut r = buffer::ByteReader::new(&bytes);
    assert_eq!(r.u8(), Some(0xAB));
    assert_eq!(r.u32_le(), Some(0xDEADBEEF));
    assert_eq!(r.varint(), Some(300));
    assert_eq!(r.f64_le(), Some(3.5));
    assert!(r.at_end());
}

// ── fmt ────────────────────────────────────────────────────────────────────

#[test]
fn fmt_radix_and_padding() {
    assert_eq!(fmt::to_radix(255, 16), b"ff");
    assert_eq!(fmt::i64_to_radix(-42, 2), b"-101010");
    assert_eq!(fmt::from_radix(b"ff", 16), Some(255));
    assert_eq!(fmt::pad_left(b"7", 3, b'0'), b"007");
    assert_eq!(fmt::group_thousands(b"1234567", b','), b"1,234,567");
}

// ── os path utils ──────────────────────────────────────────────────────────

#[test]
fn os_path_manipulation() {
    assert_eq!(os::join(b"/usr", b"bin"), b"/usr/bin");
    assert_eq!(os::basename(b"/a/b/c.txt"), b"c.txt");
    assert_eq!(os::dirname(b"/a/b/c.txt"), b"/a/b");
    assert_eq!(os::extension(b"archive.tar.gz"), b".gz");
    assert_eq!(os::normalize(b"/a/b/../c/./d"), b"/a/c/d");
    assert!(os::is_absolute(b"/x"));
}

// ── io line utils ──────────────────────────────────────────────────────────

#[test]
fn io_line_splitting() {
    let text = b"line1\r\nline2\nline3";
    let lines = io::split_lines(text);
    assert_eq!(lines.len(), 3);
    assert_eq!(lines[0], b"line1");
    assert_eq!(io::count_lines(text), 2);
    let mut r = io::LineReader::new(text);
    assert_eq!(r.next_line(), Some(&b"line1"[..]));
}

// ── matrix ─────────────────────────────────────────────────────────────────

#[test]
fn matrix_multiply_and_det() {
    let a = Matrix::from_rows(&[vec![1.0, 2.0], vec![3.0, 4.0]]);
    let id = Matrix::identity(2);
    let prod = a.mul(&id).unwrap();
    assert_eq!(prod.data, a.data);
    assert_eq!(a.det(), Some(-2.0));
    assert_eq!(a.transpose().get(0, 1), 3.0);
    assert_eq!(a.trace(), 5.0);
}

// ── json ───────────────────────────────────────────────────────────────────

#[test]
fn json_validate_accepts_and_rejects() {
    use skald::json::{json_validate, JsonError};
    assert_eq!(json_validate(br#"{"a":[1,2,3],"b":null}"#), JsonError::Ok);
    assert_eq!(json_validate(br#"{"a":}"#), JsonError::Unexpected);
    assert_ne!(json_validate(br#"[1,2,"#), JsonError::Ok);
}

#[test]
fn json_minify_strips_ws() {
    use skald::json::json_minify;
    assert_eq!(json_minify(b"{ \"a\" : 1 }"), b"{\"a\":1}");
}

// ── lexer ──────────────────────────────────────────────────────────────────

#[test]
fn lexer_counts_tokens() {
    let n = skald::lexer::tokenize_all(b"let x = 1 + 2 * 3;");
    assert!(n > 5);
}

// ── bytecode loader ────────────────────────────────────────────────────────

#[test]
fn bytecode_rejects_short_input() {
    assert!(skald::bytecode::chunk_load(b"SKLD").is_none());
    assert!(skald::bytecode::chunk_load(&[]).is_none());
}

// ── trie ───────────────────────────────────────────────────────────────────

#[test]
fn trie_prefix_queries() {
    use skald::ds::trie::Trie;
    let mut t = Trie::new();
    t.insert(b"cat", 1);
    t.insert(b"car", 2);
    t.insert(b"card", 3);
    t.insert(b"dog", 4);
    assert_eq!(t.get(b"car"), Some(2));
    assert!(t.contains(b"card"));
    assert!(t.has_prefix(b"ca"));
    assert!(!t.has_prefix(b"xy"));
    assert_eq!(t.keys_with_prefix(b"car").len(), 2);
    assert_eq!(t.len(), 4);
}

// ── random ─────────────────────────────────────────────────────────────────

#[test]
fn random_is_deterministic() {
    use skald::util::random::Xoshiro256;
    let mut a = Xoshiro256::new(42);
    let mut b = Xoshiro256::new(42);
    for _ in 0..100 {
        assert_eq!(a.next_u64(), b.next_u64());
    }
    let mut r = Xoshiro256::new(7);
    for _ in 0..1000 {
        assert!(r.below(10) < 10);
        let f = r.next_f64();
        assert!((0.0..1.0).contains(&f));
    }
}

// ── text helpers ───────────────────────────────────────────────────────────

#[test]
fn text_transforms() {
    use skald::stdlib::text;
    assert_eq!(text::title_case(b"hello world"), b"Hello World");
    assert_eq!(text::swap_case(b"AbC"), b"aBc");
    assert_eq!(text::center(b"hi", 6, b'*'), b"**hi**");
    assert_eq!(text::count_occurrences(b"abababab", b"ab"), 4);
    assert_eq!(text::replace_all(b"a.b.c", b".", b"/"), b"a/b/c");
    assert_eq!(text::edit_distance(b"kitten", b"sitting"), 3);
}

// ── datetime ───────────────────────────────────────────────────────────────

#[test]
fn datetime_roundtrip() {
    use skald::stdlib::datetime::{self, DateTime};
    // 2001-09-09T01:46:40Z is Unix timestamp 1_000_000_000.
    let dt = datetime::from_timestamp(1_000_000_000);
    assert_eq!(
        dt,
        DateTime {
            year: 2001,
            month: 9,
            day: 9,
            hour: 1,
            minute: 46,
            second: 40
        }
    );
    assert_eq!(datetime::to_timestamp(dt), 1_000_000_000);
    assert_eq!(datetime::format_iso(dt), "2001-09-09T01:46:40Z");
    assert!(datetime::is_leap_year(2000));
    assert!(!datetime::is_leap_year(1900));
}

// ── checksums ──────────────────────────────────────────────────────────────

#[test]
fn checksum_adler_and_luhn() {
    use skald::util::checksum;
    // Adler-32("Wikipedia") == 0x11E60398
    assert_eq!(checksum::adler32(b"Wikipedia"), 0x11E60398);
    assert!(checksum::luhn_valid(b"79927398713"));
    assert!(!checksum::luhn_valid(b"79927398710"));
}

// ── lru cache ──────────────────────────────────────────────────────────────

#[test]
fn lru_evicts_least_recent() {
    use skald::ds::lru::LruCache;
    let mut c = LruCache::new(2);
    c.put(b"a", 1);
    c.put(b"b", 2);
    assert_eq!(c.get(b"a"), Some(1)); // touch a → b is now LRU
    c.put(b"c", 3); // evicts b
    assert!(!c.contains(b"b"));
    assert!(c.contains(b"a"));
    assert!(c.contains(b"c"));
    assert_eq!(c.len(), 2);
}
