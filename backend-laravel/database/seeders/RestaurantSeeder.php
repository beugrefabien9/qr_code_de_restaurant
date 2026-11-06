<?php

namespace Database\Seeders;

use App\Models\Category;
use App\Models\Order;
use App\Models\OrderItem;
use App\Models\Payment;
use App\Models\Product;
use App\Models\Reservation;
use App\Models\Restaurant;
use App\Models\Table;
use Illuminate\Database\Seeder;

class RestaurantSeeder extends Seeder
{
    public function run(): void
    {
        $restaurant = Restaurant::create([
            'name' => 'Le Petit Gourmet',
            'address' => '12 rue de la Paix',
            'phone' => '+33123456789',
            'email' => 'contact@lepetitgourmet.fr',
            'city' => 'Paris',
            'status' => 'active',
        ]);

        $table1 = Table::create([
            'restaurant_id' => $restaurant->id,
            'number' => 1,
            'capacity' => 4,
            'status' => 'available',
        ]);

        $table2 = Table::create([
            'restaurant_id' => $restaurant->id,
            'number' => 2,
            'capacity' => 2,
            'status' => 'occupied',
        ]);

        $category1 = Category::create([
            'restaurant_id' => $restaurant->id,
            'name' => 'Plats',
        ]);

        $category2 = Category::create([
            'restaurant_id' => $restaurant->id,
            'name' => 'Boissons',
        ]);

        $burger = Product::create([
            'restaurant_id' => $restaurant->id,
            'category_id' => $category1->id,
            'name' => 'Burger Maison',
            'description' => 'Burger avec cheddar, salade et frites',
            'price' => 4500,
            'stock' => 25,
            'available_quantity' => 25,
            'status' => 'available',
        ]);

        $coffee = Product::create([
            'restaurant_id' => $restaurant->id,
            'category_id' => $category2->id,
            'name' => 'Café',
            'description' => 'Café noir',
            'price' => 700,
            'stock' => 50,
            'available_quantity' => 50,
            'status' => 'available',
        ]);

        $order = Order::create([
            'restaurant_id' => $restaurant->id,
            'table_id' => $table1->id,
            'customer_name' => 'Jean Dupont',
            'status' => 'pending',
            'total_amount' => 5200,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $burger->id,
            'quantity' => 1,
            'unit_price' => 4500,
            'total_price' => 4500,
        ]);

        OrderItem::create([
            'order_id' => $order->id,
            'product_id' => $coffee->id,
            'quantity' => 1,
            'unit_price' => 700,
            'total_price' => 700,
        ]);

        Reservation::create([
            'restaurant_id' => $restaurant->id,
            'table_id' => $table2->id,
            'customer_name' => 'Marie Martin',
            'phone' => '+33612345678',
            'reservation_date' => now()->addDay(),
            'guests' => 2,
            'status' => 'confirmed',
        ]);

        Payment::create([
            'order_id' => $order->id,
            'amount' => 5200,
            'payment_method' => 'cash',
            'status' => 'paid',
        ]);
    }
}
