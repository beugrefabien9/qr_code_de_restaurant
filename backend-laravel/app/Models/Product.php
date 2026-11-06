<?php

namespace App\Models;

use App\Models\Concerns\BelongsToRestaurant;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;

class Product extends Model
{
    use BelongsToRestaurant, HasFactory;

    protected $fillable = [
        'restaurant_id',
        'category_id',
        'name',
        'description',
        'image_url',
        'price',
        'stock',
        'status',
        'category',
        'preparation_time',
        'available_quantity',
        'is_available',
        'is_active',
    ];

    protected $casts = [
        'price' => 'float',
        'stock' => 'integer',
        'preparation_time' => 'integer',
        'available_quantity' => 'integer',
        'is_available' => 'boolean',
        'is_active' => 'boolean',
    ];

    public function restaurant(): BelongsTo
    {
        return $this->belongsTo(Restaurant::class);
    }

    public function category(): BelongsTo
    {
        return $this->belongsTo(Category::class);
    }

    public function orderItems(): HasMany
    {
        return $this->hasMany(OrderItem::class);
    }

    public function getCategoryNameAttribute(): string
    {
        $category = $this->relationLoaded('category')
            ? $this->getRelation('category')
            : ($this->category_id ? $this->category()->first() : null);

        return $category?->name ?? $this->category_value ?? 'Plats';
    }

    public function getCategoryValueAttribute(): string
    {
        return (string) ($this->attributes['category'] ?? 'Plats');
    }
}
