// Hiển thị số theo kiểu Việt Nam: 1,2 m; 2 000 kg. Chỉ để hiện, không dùng để tính.
const meters = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 2 });
const integer = new Intl.NumberFormat('vi-VN', { maximumFractionDigits: 0 });

export const formatMeters = (value) => meters.format(value);
export const formatInt = (value) => integer.format(value);
