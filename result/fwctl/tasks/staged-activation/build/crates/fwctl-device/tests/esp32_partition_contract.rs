use std::collections::BTreeMap;

use fwctl_device::Region;
use fwctl_device::boards::esp32::{FLASH_CAPACITY, SLOT_LAYOUT};

const PARTITIONS: &str = include_str!("../../../boards/esp32-reference/partitions.csv");

#[derive(Debug, PartialEq, Eq)]
struct Partition<'a> {
    kind: &'a str,
    subtype: &'a str,
    region: Region,
}

fn hex(field: &str) -> u32 {
    u32::from_str_radix(field.trim_start_matches("0x"), 16).unwrap()
}

fn partition_table() -> BTreeMap<&'static str, Partition<'static>> {
    PARTITIONS
        .lines()
        .filter(|line| !line.trim_start().starts_with('#'))
        .filter(|line| !line.trim().is_empty())
        .map(|line| {
            let mut fields = line.split(',').map(str::trim);
            let name = fields.next().unwrap();
            let kind = fields.next().unwrap();
            let subtype = fields.next().unwrap();
            let start = hex(fields.next().unwrap());
            let len = hex(fields.next().unwrap());
            (
                name,
                Partition {
                    kind,
                    subtype,
                    region: Region { start, len },
                },
            )
        })
        .collect()
}

#[test]
fn csv_and_firmware_layout_are_one_contract() {
    let table = partition_table();
    let expected = [
        ("ota_0", "app", "ota_0", SLOT_LAYOUT.slot_a),
        ("ota_1", "app", "ota_1", SLOT_LAYOUT.slot_b),
        ("fwmeta0", "0x40", "0x00", SLOT_LAYOUT.metadata_a),
        ("fwmeta1", "0x40", "0x01", SLOT_LAYOUT.metadata_b),
    ];

    for (name, kind, subtype, region) in expected {
        assert_eq!(
            table.get(name),
            Some(&Partition {
                kind,
                subtype,
                region,
            }),
            "partition `{name}` drifted from the firmware layout"
        );
    }

    assert_eq!(table["otadata"].region.len, 0x2000);
    assert!(SLOT_LAYOUT.slot_a.start.is_multiple_of(0x1_0000));
    assert!(SLOT_LAYOUT.slot_b.start.is_multiple_of(0x1_0000));
    assert!(
        table
            .values()
            .all(|partition| partition.region.end().unwrap() <= FLASH_CAPACITY)
    );
}

#[test]
fn csv_regions_never_overlap() {
    let table = partition_table();
    let regions: Vec<_> = table.iter().collect();
    for (index, (left_name, left)) in regions.iter().enumerate() {
        for (right_name, right) in &regions[index + 1..] {
            assert!(
                !left.region.overlaps(right.region),
                "partitions `{left_name}` and `{right_name}` overlap"
            );
        }
    }
}

#[test]
fn every_writable_region_is_erase_aligned() {
    for (name, partition) in partition_table() {
        assert!(
            partition.region.start.is_multiple_of(0x1000)
                && partition.region.len.is_multiple_of(0x1000),
            "partition `{name}` is not 4 KiB aligned"
        );
    }
}
