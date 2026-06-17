#!/usr/bin/env python3
"""Generate clean PNG icons from SVG template"""
from PIL import Image, ImageDraw
import math

# 512x512 canvas
SIZE = 512
PADDING = 64  # 12.5% padding for maskable

# Colors
BG_COLOR = (74, 144, 217)  # #4A90D9
WHITE = (255, 255, 255)

def draw_rounded_rect(draw, xy, radius, fill):
    """Draw a rounded rectangle"""
    x1, y1, x2, y2 = xy
    # Draw main rectangle
    draw.rectangle([x1+radius, y1, x2-radius, y2], fill=fill)
    draw.rectangle([x1, y1+radius, x2, y2-radius], fill=fill)
    # Draw four corners
    draw.pieslice([x1, y1, x1+radius*2, y1+radius*2], 180, 270, fill=fill)
    draw.pieslice([x2-radius*2, y1, x2, y1+radius*2], 270, 360, fill=fill)
    draw.pieslice([x1, y2-radius*2, x1+radius*2, y2], 90, 180, fill=fill)
    draw.pieslice([x2-radius*2, y2-radius*2, x2, y2], 0, 90, fill=fill)

def create_icon(size):
    """Create icon at specified size"""
    img = Image.new('RGBA', (size, size), (0, 0, 0, 0))
    draw = ImageDraw.Draw(img)
    
    # Scale factor
    s = size / 512
    pad = int(PADDING * s)
    
    # Background: rounded square (iOS superellipse approx)
    corner = int(96 * s)
    draw_rounded_rect(draw, (0, 0, size, size), corner, BG_COLOR)
    
    # Three kanban columns (white bars)
    bar_width = int(56 * s)
    gap = int(24 * s)
    center_x = size // 2
    
    # Left bar (short)
    bar1_h = int(140 * s)
    bar1_x = center_x - gap - bar_width - bar_width//2
    bar1_y = size - pad - bar1_h
    draw.rounded_rectangle(
        [bar1_x, bar1_y, bar1_x + bar_width, bar1_y + bar1_h],
        radius=int(10*s),
        fill=WHITE
    )
    
    # Middle bar (tall)
    bar2_h = int(200 * s)
    bar2_x = center_x - bar_width//2
    bar2_y = size - pad - bar2_h
    draw.rounded_rectangle(
        [bar2_x, bar2_y, bar2_x + bar_width, bar2_y + bar2_h],
        radius=int(10*s),
        fill=WHITE
    )
    
    # Right bar (medium)
    bar3_h = int(160 * s)
    bar3_x = center_x + gap + bar_width//2
    bar3_y = size - pad - bar3_h
    draw.rounded_rectangle(
        [bar3_x, bar3_y, bar3_x + bar_width, bar3_y + bar3_h],
        radius=int(10*s),
        fill=WHITE
    )
    
    # Checkmark
    check_color = BG_COLOR
    check_width = int(28 * s)
    
    # Checkmark points (diagonal across the bars)
    p1 = (center_x - int(70*s), size//2 + int(20*s))
    p2 = (center_x - int(10*s), size//2 + int(70*s))
    p3 = (center_x + int(90*s), size//2 - int(50*s))
    
    # Draw thick lines
    draw.line([p1, p2], fill=check_color, width=check_width)
    draw.line([p2, p3], fill=check_color, width=check_width)
    
    # Round the joints
    r = check_width // 2
    draw.ellipse([p2[0]-r, p2[1]-r, p2[0]+r, p2[1]+r], fill=check_color)
    
    return img

# Generate icons
for size in [512, 192]:
    icon = create_icon(size)
    icon.save(f'icon-{size}.png', 'PNG', optimize=True)
    print(f'Generated icon-{size}.png')

print('Done!')
