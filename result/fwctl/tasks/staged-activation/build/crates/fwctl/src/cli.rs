use std::path::PathBuf;
use std::time::Duration;

use clap::{Args, Parser, Subcommand};

#[derive(Debug, Parser)]
#[command(name = "fwctl", version, about = "Safe embedded firmware delivery")]
pub struct Cli {
    #[arg(long, global = true, value_name = "ID")]
    pub device: Option<String>,
    #[arg(long, global = true)]
    pub json: bool,
    #[arg(long, global = true, conflicts_with = "verbose")]
    pub quiet: bool,
    #[arg(long, global = true, conflicts_with = "quiet")]
    pub verbose: bool,
    #[arg(long, global = true, value_parser = parse_duration)]
    pub timeout: Option<Duration>,
    #[arg(long, global = true, value_name = "FILE")]
    pub config: Option<PathBuf>,
    #[command(subcommand)]
    pub command: Command,
}

#[derive(Debug, Subcommand)]
pub enum Command {
    Version,
    Devices,
    Info(DeviceTarget),
    Package(PackageArgs),
    Inspect(PackagePath),
    Verify(PackagePath),
    Update(UpdateArgs),
    Status(DeviceTarget),
    Confirm(DeviceTarget),
    Rollback(DeviceTarget),
    History(HistoryArgs),
    Doctor,
    Keys {
        #[command(subcommand)]
        action: KeyAction,
    },
}

#[derive(Debug, Args)]
pub struct DeviceTarget {
    #[arg(value_name = "DEVICE")]
    pub device: Option<String>,
}

#[derive(Debug, Args)]
pub struct PackagePath {
    #[arg(value_name = "PACKAGE")]
    pub package: PathBuf,
}

#[derive(Debug, Args)]
pub struct PackageArgs {
    #[arg(long)]
    pub product: String,
    #[arg(long)]
    pub version: String,
    #[arg(long, value_delimiter = ',', num_args = 1..)]
    pub hardware: Vec<String>,
    #[arg(long)]
    pub rollback_counter: u64,
    #[arg(long)]
    pub image: PathBuf,
    #[arg(long)]
    pub key: PathBuf,
    #[arg(long)]
    pub output: PathBuf,
    #[arg(long)]
    pub release_notes: Option<PathBuf>,
    #[arg(long)]
    pub force: bool,
}

#[derive(Debug, Args)]
pub struct UpdateArgs {
    #[arg(value_name = "PACKAGE")]
    pub package: PathBuf,
    #[arg(long)]
    pub allow_downgrade: bool,
    #[arg(long, value_name = "BYTES")]
    pub chunk_size: Option<usize>,
}

#[derive(Debug, Args)]
pub struct HistoryArgs {
    #[arg(long, value_name = "ID")]
    pub device: Option<String>,
    #[arg(long, default_value_t = 20)]
    pub limit: usize,
}

#[derive(Debug, Subcommand)]
pub enum KeyAction {
    List,
    Add {
        #[arg(value_name = "PUBLIC_KEY")]
        key: PathBuf,
        #[arg(long)]
        id: Option<String>,
    },
    Remove {
        #[arg(value_name = "KEY_ID")]
        id: String,
    },
}

fn parse_duration(value: &str) -> Result<Duration, String> {
    humantime::parse_duration(value).map_err(|err| err.to_string())
}

#[cfg(test)]
mod tests {
    use clap::Parser;

    use super::*;

    #[test]
    fn parses_package_hardware_list() {
        let cli = Cli::try_parse_from([
            "fwctl",
            "package",
            "--product",
            "sensor-node",
            "--version",
            "1.2.0",
            "--hardware",
            "A1,A2",
            "--rollback-counter",
            "7",
            "--image",
            "app.bin",
            "--key",
            "release.key",
            "--output",
            "app.fwpkg",
        ])
        .unwrap();

        let Command::Package(args) = cli.command else {
            panic!("expected package command");
        };
        assert_eq!(args.hardware, ["A1", "A2"]);
        assert_eq!(args.rollback_counter, 7);
    }

    #[test]
    fn accepts_global_options_after_subcommand() {
        let cli =
            Cli::try_parse_from(["fwctl", "status", "rack-3", "--json", "--timeout", "750ms"])
                .unwrap();
        assert!(cli.json);
        assert_eq!(cli.timeout, Some(Duration::from_millis(750)));
    }

    #[test]
    fn rejects_conflicting_output_flags() {
        assert!(Cli::try_parse_from(["fwctl", "--quiet", "--verbose", "devices"]).is_err());
    }
}
