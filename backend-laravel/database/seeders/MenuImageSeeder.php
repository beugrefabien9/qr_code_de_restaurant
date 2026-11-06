<?php

namespace Database\Seeders;

use App\Models\Product;
use Illuminate\Database\Seeder;

class MenuImageSeeder extends Seeder
{
    public function run(): void
    {
        $images = [
            'Burger Maison' => '1f354.png',
            'Café' => '2615.png',
            'Salade fraîcheur' => '1f957.png',
            'Pastels au thon' => '1f95f.png',
            'Poulet braisé' => '1f357.png',
            'Thiéboudiène' => '1f35a.png',
            'Yassa au poulet' => '1f35b.png',
            'Riz sauté aux crevettes' => '1f364.png',
            'Jus de bissap' => '1f964.png',
            'Jus de gingembre' => '1fada.png',
            'Eau minérale' => '1f4a7.png',
            'Thiakry' => '1f36e.png',
            'Salade de fruits' => '1f353.png',
        ];

        foreach ($images as $productName => $imageName) {
            Product::query()
                ->where('name', $productName)
                ->whereNull('image_url')
                ->update(['image_url' => "/menu-images/{$imageName}"]);
        }
    }
}
