//! Synchronous, instance-local ABI. Output is valid until the next validation.
use std::cell::RefCell;

thread_local! {
    static OUTPUT: RefCell<Vec<u8>> = const { RefCell::new(Vec::new()) };
}

#[unsafe(no_mangle)]
pub extern "C" fn alloc(len: usize) -> *mut u8 {
    Box::into_raw(vec![0_u8; len].into_boxed_slice()).cast::<u8>()
}

/// # Safety
/// `ptr` must come from `alloc(len)` and must not have been freed.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn dealloc(ptr: *mut u8, len: usize) {
    unsafe { drop(Box::from_raw(std::ptr::slice_from_raw_parts_mut(ptr, len))) };
}

/// # Safety
/// `ptr..ptr+len` must be initialized UTF-8 in this instance's memory.
/// Consume the returned length-prefixed records before calling again.
#[unsafe(no_mangle)]
pub unsafe extern "C" fn validate(ptr: *const u8, len: usize, max_depth: usize) -> *const u8 {
    let bytes = unsafe { std::slice::from_raw_parts(ptr, len) };
    let html = std::str::from_utf8(bytes).expect("caller supplies UTF-8");
    let outcome = super::validate_with_max_depth(html, max_depth);
    OUTPUT.with_borrow_mut(|out| {
        out.clear();
        out.extend_from_slice(&[0; 4]);
        let mut record = |tag: u8, text: &str| {
            out.push(tag);
            out.extend_from_slice(&(text.len() as u32).to_le_bytes());
            out.extend_from_slice(text.as_bytes());
        };
        for error in &outcome.errors {
            record(b'E', error);
        }
        if let Some(title) = &outcome.title {
            record(b'T', title);
        }
        for src in &outcome.img_srcs {
            record(b'I', src);
        }
        if outcome.has_scripts {
            record(b'S', "");
        }
        let length = (out.len() - 4) as u32;
        out[..4].copy_from_slice(&length.to_le_bytes());
        out.as_ptr()
    })
}
