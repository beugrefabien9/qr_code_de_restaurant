<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Product;
use App\Models\Restaurant;
use Illuminate\Database\Seeder;

class MenuSeeder extends Seeder
{
    public function run(): void
    {
        $restaurant = Restaurant::query()->firstOrFail();

        $menu = [
            'Entrées' => [
                [
                    'name' => 'Salade fraîcheur',
                    'description' => 'Salade verte, tomates, concombre et vinaigrette maison.',
                    'price' => 2500,
                    'preparation_time' => 8,
                    'stock' => 20,
                ],
                [
                    'name' => 'Pastels au thon',
                    'description' => 'Pastels croustillants au thon servis avec une sauce maison.',
                    'price' => 2000,
                    'preparation_time' => 10,
                    'stock' => 20,
                ],
            ],
            'Plats' => [
                [
                    'name' => 'Burger Maison',
                    'description' => 'Burger avec cheddar, salade et frites.',
                    'price' => 4500,
                    'preparation_time' => 15,
                    'stock' => 25,
                ],
                [
                    'name' => 'Poulet braisé',
                    'description' => 'Poulet braisé, accompagné de riz et de sa sauce maison.',
                    'price' => 5000,
                    'preparation_time' => 25,
                    'stock' => 20,
                ],
                [
                    'name' => 'Thiéboudiène',
                    'description' => 'Riz au poisson accompagné de légumes et d’une sauce tomate.',
                    'price' => 4500,
                    'preparation_time' => 30,
                    'stock' => 18,
                ],
                [
                    'name' => 'Yassa au poulet',
                    'description' => 'Poulet mariné au citron et aux oignons, servi avec du riz.',
                    'price' => 4500,
                    'preparation_time' => 25,
                    'stock' => 20,
                ],
                [
                    'name' => 'Riz sauté aux crevettes',
                    'description' => 'Riz sauté aux légumes et aux crevettes.',
                    'price' => 5500,
                    'preparation_time' => 20,
                    'stock' => 15,
                ],
            ],
            'Boissons' => [
                [
                    'name' => 'Café',
                    'description' => 'Café noir.',
                    'price' => 700,
                    'preparation_time' => 5,
                    'stock' => 50,
                ],
                [
                    'name' => 'Jus de bissap',
                    'description' => 'Boisson fraîche à base de fleurs d’hibiscus.',
                    'price' => 1000,
                    'preparation_time' => 2,
                    'stock' => 30,
                ],
                [
                    'name' => 'Jus de gingembre',
                    'description' => 'Boisson fraîche au gingembre et au citron.',
                    'price' => 1000,
                    'preparation_time' => 2,
                    'stock' => 30,
                ],
                [
                    'name' => 'Eau minérale',
                    'description' => 'Bouteille d’eau minérale.',
                    'price' => 500,
                    'preparation_time' => 1,
                    'stock' => 50,
                ],
            ],
            'Desserts' => [
                [
                    'name' => 'Thiakry',
                    'description' => 'Dessert frais au mil et au yaourt.',
                    'price' => 1500,
                    'preparation_time' => 3,
                    'stock' => 15,
                ],
                [
                    'name' => 'Salade de fruits',
                    'description' => 'Assortiment de fruits frais de saison.',
                    'price' => 1800,
                    'preparation_time' => 5,
                    'stock' => 15,
                ],
            ],
        ];

        foreach ($menu as $categoryName => $items) {
            $category = Category::query()->updateOrCreate(
                ['restaurant_id' => $restaurant->id, 'name' => $categoryName],
            );

            foreach ($items as $item) {
                $product = Product::query()->firstOrNew([
                    'restaurant_id' => $restaurant->id,
                    'name' => $item['name'],
                ]);
                $isNew = ! $product->exists;

                $product->fill([
                    'category_id' => $category->id,
                    'category' => $categoryName,
                    'description' => $item['description'],
                    'price' => $item['price'],
                    'preparation_time' => $item['preparation_time'],
                    'status' => 'available',
                    'is_available' => $isNew ? true : $product->is_available,
                    'is_active' => $isNew ? true : $product->is_active,
                ]);

                if ($isNew) {
                    $product->stock = $item['stock'];
                    $product->available_quantity = $item['stock'];
                }

                $product->save();
            }
        }
    }
}
