use std::fmt;
use std::io::{self, Write};

use fwctl_core::{FwctlError, Result};
use serde::Serialize;

pub struct Output<W, E> {
    stdout: W,
    stderr: E,
    json: bool,
    quiet: bool,
    verbose: bool,
}

pub type StdOutput = Output<io::Stdout, io::Stderr>;

impl StdOutput {
    pub fn stdio(json: bool, quiet: bool, verbose: bool) -> Self {
        Self {
            stdout: io::stdout(),
            stderr: io::stderr(),
            json,
            quiet,
            verbose,
        }
    }
}

impl Output<Vec<u8>, Vec<u8>> {
    #[cfg(test)]
    fn buffered(json: bool, quiet: bool, verbose: bool) -> Self {
        Self {
            stdout: Vec::new(),
            stderr: Vec::new(),
            json,
            quiet,
            verbose,
        }
    }
}

impl<W: Write, E: Write> Output<W, E> {
    pub fn success<T: Serialize>(&mut self, value: &T, human: fmt::Arguments<'_>) -> Result<()> {
        if self.json {
            serde_json::to_writer(&mut self.stdout, value)
                .map_err(|err| FwctlError::Configuration(err.to_string()))?;
            self.stdout
                .write_all(b"\n")
                .map_err(|err| FwctlError::io("stdout", err))?;
        } else if !self.quiet {
            writeln!(self.stdout, "{human}").map_err(|err| FwctlError::io("stdout", err))?;
        }
        Ok(())
    }

    pub fn detail(&mut self, message: fmt::Arguments<'_>) -> Result<()> {
        if self.verbose {
            writeln!(self.stderr, "{message}").map_err(|err| FwctlError::io("stderr", err))?;
        }
        Ok(())
    }

    pub fn progress(&mut self, message: fmt::Arguments<'_>) -> Result<()> {
        if !self.quiet {
            writeln!(self.stderr, "{message}").map_err(|err| FwctlError::io("stderr", err))?;
        }
        Ok(())
    }

    pub fn warning(&mut self, message: fmt::Arguments<'_>) -> Result<()> {
        writeln!(self.stderr, "warning: {message}").map_err(|err| FwctlError::io("stderr", err))
    }

    pub fn failure(&mut self, err: &FwctlError) {
        if self.json {
            let body = ErrorOutput {
                ok: false,
                error: err.to_string(),
                category: err.category(),
            };
            let _ = serde_json::to_writer(&mut self.stdout, &body);
            let _ = self.stdout.write_all(b"\n");
        } else {
            let _ = writeln!(self.stderr, "error: {err}");
        }
    }
}

#[derive(Serialize)]
struct ErrorOutput {
    ok: bool,
    error: String,
    category: fwctl_core::ErrorCategory,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[derive(Serialize)]
    struct Record {
        state: &'static str,
    }

    #[test]
    fn json_success_is_single_stdout_record() {
        let mut output = Output::buffered(true, false, false);
        output
            .success(&Record { state: "ready" }, format_args!("ready"))
            .unwrap();

        assert_eq!(output.stdout, b"{\"state\":\"ready\"}\n");
    }

    #[test]
    fn quiet_suppresses_human_success() {
        let mut output = Output::buffered(false, true, false);
        output
            .success(&Record { state: "ready" }, format_args!("ready"))
            .unwrap();
        assert!(output.stdout.is_empty());
        assert!(output.stderr.is_empty());
    }
}
