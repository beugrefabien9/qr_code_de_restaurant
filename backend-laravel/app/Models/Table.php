<?php

namespace App\Models;

use App\Models\Concerns\BelongsToRestaurant;
use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\BelongsTo;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Support\Str;

class Table extends Model
{
    use BelongsToRestaurant, HasFactory;

    protected $table = 'tables';

    protected $fillable = [
        'restaurant_id',
        'number',
        'capacity',
        'status',
    ];

    protected static function booted(): void
    {
        static::creating(function (self $table): void {
            $table->qr_token ??= (string) Str::uuid();
        });
    }

    public function restaurant(): BelongsTo
    {
        return $this->belongsTo(Restaurant::class);
    }

    public function reservations(): HasMany
    {
        return $this->hasMany(Reservation::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }
}
