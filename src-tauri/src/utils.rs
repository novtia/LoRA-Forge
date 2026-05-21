use std::{
    cmp::Ordering,
    ffi::OsStr,
    fs,
    path::{Path, PathBuf},
    process::Command,
    time::{SystemTime, UNIX_EPOCH},
};

use crate::error::{AppError, AppResult};

/// Spawn a console subprocess from the Tauri GUI without a flashing `cmd` window on Windows.
pub fn hidden_std_command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(target_os = "windows")]
    {
        use std::os::windows::process::CommandExt;
        cmd.creation_flags(0x08000000); // CREATE_NO_WINDOW
    }
    cmd
}

pub fn now_ts() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|duration| duration.as_secs() as i64)
        .unwrap_or_default()
}

pub fn slugify(input: &str) -> String {
    let slug = input
        .chars()
        .map(|character| match character {
            'a'..='z' | '0'..='9' => character,
            'A'..='Z' => character.to_ascii_lowercase(),
            _ => '-',
        })
        .collect::<String>()
        .split('-')
        .filter(|segment| !segment.is_empty())
        .collect::<Vec<_>>()
        .join("-");

    if slug.is_empty() {
        "project".to_string()
    } else {
        slug
    }
}

/// String order where contiguous ASCII digit runs are compared by numeric value
/// (e.g. `image (2).png` before `image (10).png`).
pub fn cmp_str_natural(left: &str, right: &str) -> Ordering {
    let left = left.as_bytes();
    let right = right.as_bytes();
    let mut i = 0usize;
    let mut j = 0usize;
    while i < left.len() && j < right.len() {
        let lc = left[i];
        let rc = right[j];
        if lc.is_ascii_digit() && rc.is_ascii_digit() {
            let (ln, li) = scan_ascii_u64(left, i);
            let (rn, rj) = scan_ascii_u64(right, j);
            match ln.cmp(&rn) {
                Ordering::Equal => {
                    i = li;
                    j = rj;
                }
                ord => return ord,
            }
        } else {
            match lc.cmp(&rc) {
                Ordering::Equal => {
                    i += 1;
                    j += 1;
                }
                ord => return ord,
            }
        }
    }
    left.len().cmp(&right.len())
}

fn scan_ascii_u64(bytes: &[u8], start: usize) -> (u64, usize) {
    let mut i = start;
    let mut n: u64 = 0;
    while i < bytes.len() && bytes[i].is_ascii_digit() {
        n = n.saturating_mul(10).saturating_add(u64::from(bytes[i] - b'0'));
        i += 1;
    }
    (n, i)
}

pub fn normalize_relative_path(path: &Path) -> String {
    path.components()
        .map(|component| component.as_os_str().to_string_lossy().to_string())
        .collect::<Vec<_>>()
        .join("/")
}

pub fn normalize_display_path(path: &Path) -> String {
    normalize_display_path_string(&path.to_string_lossy())
}

pub fn normalize_display_path_string(path: &str) -> String {
    if let Some(stripped) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{stripped}")
    } else if let Some(stripped) = path.strip_prefix(r"\\?\") {
        stripped.to_string()
    } else {
        path.to_string()
    }
}

pub fn directory_size(path: &Path) -> u64 {
    let mut total = 0_u64;

    if let Ok(entries) = fs::read_dir(path) {
        for entry in entries.flatten() {
            let entry_path = entry.path();
            if let Ok(metadata) = entry.metadata() {
                if metadata.is_dir() {
                    total = total.saturating_add(directory_size(&entry_path));
                } else {
                    total = total.saturating_add(metadata.len());
                }
            }
        }
    }

    total
}

pub fn ensure_existing_dir(path: &Path) -> AppResult<PathBuf> {
    let canonical = fs::canonicalize(path)?;
    if canonical.is_dir() {
        Ok(canonical)
    } else {
        Err(AppError::Validation(format!(
            "Expected a directory but got '{}'",
            canonical.display()
        )))
    }
}

pub fn ensure_within(base: &Path, target: &Path) -> AppResult<PathBuf> {
    let base = fs::canonicalize(base)?;
    let target = fs::canonicalize(target)?;

    if target.starts_with(&base) {
        Ok(target)
    } else {
        Err(AppError::Validation(format!(
            "Path '{}' is outside '{}'",
            target.display(),
            base.display()
        )))
    }
}

pub fn newest_file_with_extension(path: &Path, extension: &str) -> AppResult<Option<PathBuf>> {
    let mut newest: Option<(SystemTime, PathBuf)> = None;

    if !path.exists() {
        return Ok(None);
    }

    for entry in fs::read_dir(path)? {
        let entry = entry?;
        let file_path = entry.path();
        let matches_extension = file_path
            .extension()
            .and_then(|value| value.to_str())
            .map(|value| value.eq_ignore_ascii_case(extension))
            .unwrap_or(false);

        if !matches_extension {
            continue;
        }

        let modified = entry.metadata()?.modified().unwrap_or(UNIX_EPOCH);

        match &newest {
            Some((current_modified, _)) if modified <= *current_modified => {}
            _ => newest = Some((modified, file_path)),
        }
    }

    Ok(newest.map(|(_, file_path)| file_path))
}
