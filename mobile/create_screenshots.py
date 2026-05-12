from PIL import Image, ImageDraw, ImageFont

BG = '#FFF6EE'
SURFACE = '#FFFFFF'
PRIMARY = '#E8380D'
TEXT = '#1C0800'
TEXT_SEC = '#7A4F3A'
TEXT_MUTED = '#C4A090'
BORDER = '#F0D9C8'
W, H = 1080, 1920

def load_fonts():
    try:
        bold = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 52)
        med  = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 40)
        sml  = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 34)
        xsml = ImageFont.truetype('C:/Windows/Fonts/arial.ttf', 28)
        lg   = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 64)
        xl   = ImageFont.truetype('C:/Windows/Fonts/arialbd.ttf', 80)
        return bold, med, sml, xsml, lg, xl
    except:
        d = ImageFont.load_default()
        return d, d, d, d, d, d

def draw_card(draw, x, y, w, h, fill=SURFACE, radius=20):
    draw.rounded_rectangle([x, y, x+w, y+h], radius=radius, fill=fill, outline=BORDER, width=2)

def draw_status_bar(draw, font):
    draw.rectangle([0, 0, W, 80], fill=SURFACE)
    draw.text((50, 22), '9:41', fill=TEXT, font=font)
    draw.text((880, 22), 'VTech POS', fill=TEXT_SEC, font=font)

def draw_bottom_tab(draw, active, font_sml):
    tabs = ['Home', 'Billing', 'Orders', 'Reports', 'Settings']
    tab_w = W // len(tabs)
    draw.rectangle([0, H-120, W, H], fill=SURFACE)
    draw.line([(0, H-120), (W, H-120)], fill=BORDER, width=2)
    for i, tab in enumerate(tabs):
        tx = i * tab_w + tab_w // 2
        col = PRIMARY if tab == active else TEXT_MUTED
        draw.text((tx - len(tab) * 9, H - 70), tab, fill=col, font=font_sml)
    ai = tabs.index(active) if active in tabs else 0
    draw.rectangle([ai * tab_w + 20, H - 122, (ai + 1) * tab_w - 20, H - 118], fill=PRIMARY)

bold, med, sml, xsml, lg, xl = load_fonts()

# ── SCREEN 1: Home Dashboard ─────────────────────────────────────────────────
img = Image.new('RGB', (W, H), BG)
draw = ImageDraw.Draw(img)
draw_status_bar(draw, sml)

draw.rectangle([0, 80, W, 210], fill=PRIMARY)
draw.text((50, 105), 'Dine POS', fill='white', font=lg)
draw.text((50, 165), 'Good morning! Ready to serve.', fill='#FFCCBB', font=sml)

for i, (label, val, color) in enumerate([("Today's Sales", '₹4,250', PRIMARY), ('Orders', '23', '#2E7D32'), ('Pending', '5', '#F57C00')]):
    cx = 30 + i * 350
    draw_card(draw, cx, 230, 320, 160)
    draw.text((cx + 20, 250), label, fill=TEXT_SEC, font=xsml)
    draw.text((cx + 20, 305), val, fill=color, font=lg)

draw.text((50, 420), 'Quick Actions', fill=TEXT, font=bold)
actions = ['New Order', 'View Orders', 'Products', 'Reports', 'Table Map', 'Settings']
bg_cols = ['#FFF0EB', '#F0FFF4', '#FFF8E1', '#F3E5F5', '#E3F2FD', '#FCE4EC']
for i, (action, bgc) in enumerate(zip(actions, bg_cols)):
    row, col = divmod(i, 3)
    ax, ay = 30 + col * 350, 480 + row * 200
    draw_card(draw, ax, ay, 320, 170, fill=bgc)
    draw.text((ax + 30, ay + 65), action, fill=TEXT, font=sml)

draw.text((50, 910), 'Recent Orders', fill=TEXT, font=bold)
orders = [('Table 3', 'Butter Chicken x2, Naan x4', '₹680', 'Served', '#2E7D32'),
          ('Table 7', 'Biryani x1, Raita x1',       '₹320', 'Pending','#F57C00'),
          ('Table 1', 'Masala Dosa x3',              '₹240', 'Paid',   '#1565C0')]
for i, (tbl, item, amt, status, scol) in enumerate(orders):
    oy = 970 + i * 145
    draw_card(draw, 30, oy, W - 60, 125)
    draw.text((60,  oy + 18), tbl,  fill=PRIMARY, font=bold)
    draw.text((60,  oy + 72), item, fill=TEXT_SEC, font=xsml)
    draw.text((800, oy + 18), amt,  fill=TEXT,    font=bold)
    draw.rounded_rectangle([790, oy + 68, 1030, oy + 108], radius=20, fill=scol)
    draw.text((815, oy + 73), status, fill='white', font=xsml)

draw_bottom_tab(draw, 'Home', sml)
img.save('assets/screenshot-1-home.png')
print('Screenshot 1 saved')

# ── SCREEN 2: Billing ─────────────────────────────────────────────────────────
img = Image.new('RGB', (W, H), BG)
draw = ImageDraw.Draw(img)
draw_status_bar(draw, sml)

draw.rectangle([0, 80, W, 210], fill=PRIMARY)
draw.text((50, 120), 'Billing', fill='white', font=lg)
draw.text((680, 125), 'Table 3', fill='#FFCCBB', font=med)

draw.text((50, 230), 'Bill Items', fill=TEXT, font=bold)
items = [('Butter Chicken', '2', '₹260', '₹520'),
         ('Garlic Naan',    '4', '₹40',  '₹160'),
         ('Mango Lassi',    '2', '₹80',  '₹160'),
         ('Paneer Tikka',   '1', '₹220', '₹220')]
for i, (name, qty, price, total) in enumerate(items):
    iy = 300 + i * 130
    draw_card(draw, 30, iy, W - 60, 110)
    draw.text((60,  iy + 15), name,                fill=TEXT,    font=bold)
    draw.text((60,  iy + 68), f'Qty: {qty}  x  {price}', fill=TEXT_SEC, font=sml)
    draw.text((860, iy + 35), total,               fill=PRIMARY, font=bold)

ty = 840
draw_card(draw, 30, ty, W - 60, 320, fill='#FFF0EB')
draw.text((60,  ty + 20),  'Subtotal',  fill=TEXT_SEC, font=med)
draw.text((830, ty + 20),  '₹1,060',   fill=TEXT,     font=med)
draw.text((60,  ty + 80),  'Tax (5%)', fill=TEXT_SEC, font=med)
draw.text((880, ty + 80),  '₹53',      fill=TEXT,     font=med)
draw.line([(60, ty + 145), (W - 60, ty + 145)], fill=BORDER, width=2)
draw.text((60,  ty + 165), 'TOTAL',    fill=TEXT,     font=lg)
draw.text((760, ty + 165), '₹1,113',  fill=PRIMARY,  font=lg)

draw.rounded_rectangle([30,  1190, 510,    1310], radius=16, fill=PRIMARY)
draw.text((130, 1230), 'Print Bill', fill='white', font=bold)
draw.rounded_rectangle([540, 1190, W - 30, 1310], radius=16, fill='#2E7D32')
draw.text((640, 1230), 'Mark Paid',  fill='white', font=bold)

draw_bottom_tab(draw, 'Billing', sml)
img.save('assets/screenshot-2-billing.png')
print('Screenshot 2 saved')

# ── SCREEN 3: Orders ──────────────────────────────────────────────────────────
img = Image.new('RGB', (W, H), BG)
draw = ImageDraw.Draw(img)
draw_status_bar(draw, sml)

draw.rectangle([0, 80, W, 210], fill=PRIMARY)
draw.text((50, 120), 'Orders', fill='white', font=lg)

for i, f in enumerate(['All', 'Pending', 'Served', 'Paid']):
    fx = 30 + i * 265
    active = f == 'All'
    draw.rounded_rectangle([fx, 220, fx + 235, 275], radius=25,
                           fill=PRIMARY if active else SURFACE, outline=BORDER, width=2)
    draw.text((fx + 35, 230), f, fill='white' if active else TEXT_SEC, font=sml)

orders_data = [
    ('Table 3',  '#T003', 'Butter Chicken x2, Naan x4', '₹680', 'Pending', '#F57C00'),
    ('Table 7',  '#T007', 'Biryani x1, Raita x1',       '₹320', 'Served',  '#2E7D32'),
    ('Table 1',  '#T001', 'Masala Dosa x3',              '₹240', 'Paid',    '#1565C0'),
    ('Parcel',   '#T012', 'Paneer Roll x2',              '₹180', 'Pending', '#F57C00'),
    ('Table 5',  '#T005', 'Fish Curry, Rice x2',         '₹560', 'Served',  '#2E7D32'),
]
for i, (tbl, oid, items_str, amt, status, scol) in enumerate(orders_data):
    oy = 300 + i * 195
    draw_card(draw, 30, oy, W - 60, 175)
    draw.text((60,  oy + 15), tbl,           fill=TEXT,    font=bold)
    draw.text((60,  oy + 72), items_str[:44], fill=TEXT_SEC, font=xsml)
    draw.text((60,  oy + 118), oid + '  •  2 min ago', fill=TEXT_MUTED, font=xsml)
    draw.text((790, oy + 15), amt,           fill=TEXT,    font=bold)
    draw.rounded_rectangle([780, oy + 65, 1030, oy + 110], radius=20, fill=scol)
    draw.text((800, oy + 72), status,        fill='white', font=xsml)

draw_bottom_tab(draw, 'Orders', sml)
img.save('assets/screenshot-3-orders.png')
print('Screenshot 3 saved')

# ── SCREEN 4: Products/Menu ───────────────────────────────────────────────────
img = Image.new('RGB', (W, H), BG)
draw = ImageDraw.Draw(img)
draw_status_bar(draw, sml)

draw.rectangle([0, 80, W, 210], fill=PRIMARY)
draw.text((50, 120), 'Menu & Products', fill='white', font=lg)

draw.rounded_rectangle([30, 220, W - 30, 295], radius=16, fill=SURFACE, outline=BORDER, width=2)
draw.text((70, 242), 'Search products...', fill=TEXT_MUTED, font=med)

cats = ['All', 'Starters', 'Main Course', 'Breads', 'Drinks']
cx = 30
for c in cats:
    cw = len(c) * 22 + 40
    active = c == 'All'
    draw.rounded_rectangle([cx, 315, cx + cw, 370], radius=20,
                           fill=PRIMARY if active else SURFACE, outline=BORDER, width=2)
    draw.text((cx + 20, 325), c, fill='white' if active else TEXT_SEC, font=sml)
    cx += cw + 18

prods = [('Butter Chicken', '₹260'), ('Paneer Tikka', '₹220'),
         ('Garlic Naan',    '₹40'),  ('Mango Lassi',  '₹80'),
         ('Biryani',        '₹280'), ('Gulab Jamun',  '₹60')]
prod_bg = ['#FFE0CC', '#E8F5E9', '#FFF9C4', '#E3F2FD', '#FCE4EC', '#F3E5F5']
for i, (name, price) in enumerate(prods):
    row, col = divmod(i, 2)
    px, py = 30 + col * 525, 395 + row * 350
    draw_card(draw, px, py, 495, 320)
    draw.rounded_rectangle([px + 15, py + 15, px + 480, py + 195], radius=12, fill=prod_bg[i])
    draw.text((px + 20, py + 210), name,  fill=TEXT,    font=bold)
    draw.text((px + 20, py + 265), price, fill=PRIMARY, font=med)
    draw.rounded_rectangle([px + 355, py + 255, px + 480, py + 305], radius=12, fill=PRIMARY)
    draw.text((px + 375, py + 265), '+ Add', fill='white', font=sml)

draw_bottom_tab(draw, 'Products', sml)
img.save('assets/screenshot-4-products.png')
print('Screenshot 4 saved')
print('All done!')
