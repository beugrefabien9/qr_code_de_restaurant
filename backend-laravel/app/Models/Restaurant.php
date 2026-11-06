<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Factories\HasFactory;
use Illuminate\Database\Eloquent\Model;
use Illuminate\Database\Eloquent\Relations\HasMany;
use Illuminate\Database\Eloquent\Relations\HasOne;

class Restaurant extends Model
{
    use HasFactory;

    protected $fillable = [
        'name',
        'address',
        'phone',
        'email',
        'city',
        'status',
        'suspension_reason',
        'suspended_at',
    ];

    protected $casts = [
        'suspended_at' => 'datetime',
    ];

    public function tables(): HasMany
    {
        return $this->hasMany(Table::class);
    }

    public function products(): HasMany
    {
        return $this->hasMany(Product::class);
    }

    public function menus(): HasMany
    {
        return $this->hasMany(Menu::class);
    }

    public function reservations(): HasMany
    {
        return $this->hasMany(Reservation::class);
    }

    public function orders(): HasMany
    {
        return $this->hasMany(Order::class);
    }

    public function users(): HasMany
    {
        return $this->hasMany(User::class);
    }

    public function partner(): HasOne
    {
        return $this->hasOne(User::class)->where('role', 'partner');
    }
}
